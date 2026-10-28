#!/usr/bin/env node
// Backfill de análisis IA. Llama al propio servicio para no duplicar la lógica del prompt.
// Uso: node scripts/enrich-ai.js [--limit=10] [--status=Nuevo,"En Proceso",Escalado] [--force] [--status-only]
const BASE = (process.env.CIBERALERT_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

async function main() {
  const status = await fetch(`${BASE}/api/ai/enrich`, { headers }).then((r) => r.json());
  console.log(`IA: ${status.enabled ? 'activa' : 'deshabilitada'} · modelo ${status.model} · gateway ${status.baseUrl}`);
  console.log(`Alertas: ${status.total} total, ${status.analyzed} analizadas, ${status.pending} pendientes`);
  if (!status.enabled) throw new Error('IA deshabilitada (falta AI_API_KEY)');
  if (arg('status-only', false)) return;

  const limit = Number(arg('limit', 10));
  const statuses = arg('status', null);
  const body = {
    limit,
    force: arg('force', false) === true,
    statuses: statuses ? String(statuses).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };

  console.log(`Lanzando lote: ${JSON.stringify(body)}`);
  const res = await fetch(`${BASE}/api/ai/enrich`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out?.error || `HTTP ${res.status}`);

  for (const o of out.outcomes || []) {
    console.log(`  ${o.ok ? 'OK  ' : 'FAIL'} ${o.inc_id}${o.error ? ` — ${o.error}` : ''}`);
  }
  console.log(`Lote: ${out.ok}/${out.processed} correctas, ${out.failed} fallidas. Pendientes: ${out.remaining}`);
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
