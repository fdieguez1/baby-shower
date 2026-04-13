// Baby Shower API — Cloudflare Worker
// KV namespaces: REGALOS, CODIGOS

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── GET /api/regalos ──────────────────────────────────────────────────────
    if (path === "/api/regalos" && request.method === "GET") {
      const { keys } = await env.REGALOS.list();
      const regalos = await Promise.all(
        keys.map(async ({ name }) => {
          const val = await env.REGALOS.get(name, "json");
          return { id: name, ...val };
        })
      );
      regalos.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
      return json({ ok: true, regalos });
    }

    // ── GET /api/validar?codigo=XXXX ──────────────────────────────────────────
    // Endpoint dedicado para validar un código sin hacer una reserva
    if (path === "/api/validar" && request.method === "GET") {
      const codigo = url.searchParams.get("codigo")?.toUpperCase().trim();
      if (!codigo) return err("Falta el parámetro: codigo");

      const codigoData = await env.CODIGOS.get(codigo, "json");
      if (!codigoData) return json({ ok: false, estado: "invalido" });
      if (codigoData.usado) return json({ ok: true, estado: "usado" });
      return json({ ok: true, estado: "valido" });
    }

    // ── POST /api/reservar ────────────────────────────────────────────────────
    if (path === "/api/reservar" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return err("Body inválido"); }

      const { codigo, regalo_id } = body;
      if (!codigo || !regalo_id) return err("Faltan campos: codigo, regalo_id");

      // Validar código
      const codigoData = await env.CODIGOS.get(codigo, "json");
      if (!codigoData) return err("Código inválido", 403);
      if (codigoData.usado) return err("Este código ya fue utilizado", 403);

      // Validar regalo
      const regaloData = await env.REGALOS.get(regalo_id, "json");
      if (!regaloData) return err("Regalo no encontrado", 404);
      if (regaloData.reservado) return err("Este regalo ya fue reservado");

      // Escribir ambos — el regalo elegido NO se asocia al código (privacidad)
      await env.REGALOS.put(regalo_id, JSON.stringify({ ...regaloData, reservado: true }));
      await env.CODIGOS.put(codigo, JSON.stringify({ usado: true }));

      return json({ ok: true, mensaje: "¡Regalo reservado con éxito!" });
    }

    // ── GET /api/admin/codigos ────────────────────────────────────────────────
    if (path === "/api/admin/codigos" && request.method === "GET") {
      if (!validarAdmin(request, env)) return err("No autorizado", 401);

      const { keys } = await env.CODIGOS.list();
      const codigos = await Promise.all(
        keys.map(async ({ name }) => {
          const val = await env.CODIGOS.get(name, "json");
          return { codigo: name, usado: val?.usado ?? false };
        })
      );
      return json({ ok: true, codigos });
    }

    // ── POST /api/admin/init ──────────────────────────────────────────────────
    if (path === "/api/admin/init" && request.method === "POST") {
      if (!validarAdmin(request, env)) return err("No autorizado", 401);

      let body;
      try { body = await request.json(); } catch { return err("Body inválido"); }

      const { regalos, codigos } = body;

      if (regalos) {
        for (const regalo of regalos) {
          await env.REGALOS.put(regalo.id, JSON.stringify({
            nombre: regalo.nombre,
            descripcion: regalo.descripcion ?? "",
            emoji: regalo.emoji ?? "🎁",
            reservado: false,
            orden: regalo.orden ?? 0,
          }));
        }
      }

      if (codigos) {
        for (const codigo of codigos) {
          const existe = await env.CODIGOS.get(codigo);
          if (!existe) {
            await env.CODIGOS.put(codigo, JSON.stringify({ usado: false }));
          }
        }
      }

      return json({ ok: true, mensaje: "Datos cargados correctamente" });
    }

    // ── POST /api/admin/purge ─────────────────────────────────────────────────
    // Borra TODOS los códigos del KV (limpia acumulados de pruebas)
    if (path === "/api/admin/purge" && request.method === "POST") {
      if (!validarAdmin(request, env)) return err("No autorizado", 401);

      const { keys } = await env.CODIGOS.list();
      await Promise.all(keys.map(({ name }) => env.CODIGOS.delete(name)));
      return json({ ok: true, mensaje: `${keys.length} codigos eliminados` });
    }

    // ── POST /api/admin/reset ─────────────────────────────────────────────────
    // Marca todos los regalos como disponibles y todos los códigos como no usados
    if (path === "/api/admin/reset" && request.method === "POST") {
      if (!validarAdmin(request, env)) return err("No autorizado", 401);

      const [r, c] = await Promise.all([env.REGALOS.list(), env.CODIGOS.list()]);
      await Promise.all([
        ...r.keys.map(({ name }) =>
          env.REGALOS.get(name, "json").then(v =>
            env.REGALOS.put(name, JSON.stringify({ ...v, reservado: false }))
          )
        ),
        ...c.keys.map(({ name }) =>
          env.CODIGOS.put(name, JSON.stringify({ usado: false }))
        ),
      ]);
      return json({ ok: true, mensaje: "Todo reseteado" });
    }
    // ── POST /api/admin/reset-gift ────────────────────────────────────────────────
    // Reset a single gift to available (if it was mistakenly reserved)
    if (path === "/api/admin/reset-gift" && request.method === "POST") {
      if (!validarAdmin(request, env)) return err("No autorizado", 401);

      let body;
      try { body = await request.json(); } catch { return err("Body inválido"); }

      const { regalo_id } = body;
      if (!regalo_id) return err("Falta el campo: regalo_id");

      // Check if the gift exists and is reserved
      const regaloData = await env.REGALOS.get(regalo_id, "json");
      if (!regaloData) return err("Regalo no encontrado", 404);
      if (!regaloData.reservado) return err("Este regalo ya está disponible");

      // Reset the gift to available
      await env.REGALOS.put(regalo_id, JSON.stringify({ ...regaloData, reservado: false }));

      return json({ ok: true, mensaje: "Regalo reseteado correctamente" });
    }
    return err("Ruta no encontrada", 404);
  },
};

function validarAdmin(request, env) {
  const secret = request.headers.get("X-Admin-Secret");
  return secret && secret === env.ADMIN_SECRET;
}