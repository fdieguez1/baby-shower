#!/usr/bin/env node
// generate-codes.js
// Genera 12 códigos aleatorios, los sube al Worker y muestra los links listos.
//
// Uso:
//   node generate-codes.js
//
// Configurá las variables de entorno antes de correr:
//   WORKER_URL   → URL base de tu Cloudflare Worker
//   ADMIN_SECRET → El secreto que configuraste con `wrangler secret put ADMIN_SECRET`
//   SITE_URL     → URL de tu GitHub Pages (ej: https://fdieguez1.github.io/baby-shower)

import crypto from "crypto";
import https from "https";
import http from "http";

// ─── Configuración ────────────────────────────────────────────────────────────
const WORKER_URL = process.env.WORKER_URL || "https://baby-shower-api.babyshowerdieguez.workers.dev";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const SITE_URL = process.env.SITE_URL || "https://fdieguez1.github.io/baby-shower";
const CANTIDAD = 14;

// ─── Lista de regalos ─────────────────────────────────────────────────────────
// Editá esta lista con los regalos que querés mostrar
const REGALOS = [
  { id: "r01", nombre: "Cambiador fijo", descripcion: "Como una bandejita pero con bordes 'antivuelco'", emoji: "🛏️" },
  { id: "r02", nombre: "Bañerita ergonómica", descripcion: `<a href="https://articulo.mercadolibre.com.ar/MLA-1446445593-banera-plegable-bebe-recien-nacido-soporte-termometro-_JM?attributes=PATTERN_NAME%3ATGlzYQ%3D%3D%2CCOLOR_SECONDARY_COLOR%3AR3Jpcw%3D%3D&picker=true&quantity=1" target="_blank">ver en ML</a>`, emoji: "🛁" },
  { id: "r03", nombre: "Ropa 1-6 meses", descripcion: "Bodies, pijamas y ropa de abrigo o lo que sea, medias etc", emoji: "👶" },
  { id: "r04", nombre: "Ropa 1-6 meses", descripcion: "Bodies, pijamas y ropa de abrigo o lo que sea, medias etc", emoji: "👶" },
  { id: "r05", nombre: "Ropa 1-6 meses", descripcion: "Bodies, pijamas y ropa de abrigo o lo que sea, medias etc", emoji: "👶" },
  { id: "r06", nombre: "Juguetes sensoriales", descripcion: "Mordillos, sonajas y peluches o cualquier otra cosa (una pistola puede ser)", emoji: "🪀" },
  { id: "r07", nombre: "Juguetes sensoriales", descripcion: "Mordillos, sonajas y peluches o cualquier otra cosa", emoji: "🧸" },
  { id: "r08", nombre: "Pañales y oleos", descripcion: "Cualquiera esta de 10", emoji: "🚽" },
  { id: "r09", nombre: "Pañales y oleos", descripcion: "Cualquiera esta de 10", emoji: "🚽" },
  { id: "r10", nombre: "Pañales y oleos", descripcion: "Cualquiera esta de 10", emoji: "🚽" },
  { id: "r11", nombre: "Mamadera", descripcion: `Phillips avent natural <a href="https://www.mercadolibre.com.ar/mamadera-avent-philips-natural-response-125ml-0m-color-blanco-liso/p/MLA37870006#polycard_client=search-desktop&search_layout=grid&position=8&type=product&tracking_id=94159fe4-d57c-46ab-8fd9-a5ea3c8b1578&wid=MLA1829589014&sid=search" target="_blank">ver en ML</a>`, emoji: "🍼" },
  { id: "r12", nombre: "Toallas y esponja", descripcion: "Cualquiera esta de 10", emoji: "🧼" },
  { id: "r13", nombre: "Toallas y esponja", descripcion: "Cualquiera esta de 10", emoji: "🧼" },
  { id: "r14", nombre: "Chupete", descripcion: "Cualquiera esta de 10", emoji: "🍼" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generarCodigo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O,I,0,1 para evitar confusión
  return Array.from(crypto.randomBytes(6))
    .map(b => chars[b % chars.length])
    .join("");
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname, path: parsed.pathname + parsed.search,
        method: "POST", headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data), ...headers
        }
      },
      (res) => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const codigos = Array.from({ length: CANTIDAD }, generarCodigo);

  console.log("\n🎀 Baby Shower — Generador de códigos\n");
  console.log("Subiendo regalos y códigos al Worker...");

  const result = await post(
    `${WORKER_URL}/api/admin/init`,
    {
      regalos: REGALOS.map((r, i) => ({ ...r, orden: i })),
      codigos,
    },
    { "X-Admin-Secret": ADMIN_SECRET }
  );

  if (!result.ok) {
    console.error("❌ Error al subir:", result);
    process.exit(1);
  }

  console.log("✅ Datos cargados correctamente\n");
  console.log("─".repeat(60));
  console.log("LINKS PARA ENVIAR (uno por persona):");
  console.log("─".repeat(60));

  codigos.forEach((codigo, i) => {
    console.log(`\n[${String(i + 1).padStart(2, "0")}] Código: ${codigo}`);
    console.log(`     Link:   ${SITE_URL}?code=${codigo}`);
  });

  console.log("\n─".repeat(60));
  console.log("\n📋 Para ver qué códigos están quemados:");
  console.log(`   curl -H "X-Admin-Secret: ${ADMIN_SECRET}" ${WORKER_URL}/api/admin/codigos`);
  console.log("\n🔄 Para resetear todo (pruebas):");
  console.log(`   curl -X POST -H "X-Admin-Secret: ${ADMIN_SECRET}" ${WORKER_URL}/api/admin/reset`);
  console.log("");
}

main().catch(console.error);
