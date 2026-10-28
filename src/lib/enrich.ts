import { dbClient } from '@/lib/db';
import { aiEnabled, generateAlertInsights, fingerprint } from '@/lib/ai';

export interface EnrichOutcome {
  inc_id: string;
  ok: boolean;
  error?: string;
  model?: string;
}

export interface EnrichBatchResult {
  requested: number;
  processed: number;
  ok: number;
  failed: number;
  remaining: number;
  stopped?: string;
  outcomes: EnrichOutcome[];
}

const SELECT_FIELDS = `id, inc_id, title, alert_type, alert_type_desc, severity, status, result, action_edr,
  hostname, username, endpoint_group, file_hash, file_path, raw_summary, next_step, ai_summary, ai_recommendation`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function intEnv(value: string | undefined, fallback: number) {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const saturating = (message?: string) => !!message && /gateway (429|408|5\d\d)/.test(message);

// Genera y persiste resumen + recomendación para una alerta concreta.
export async function enrichAlertByInc(inc: string) {
  if (!aiEnabled()) throw new Error('IA deshabilitada: configura AI_API_KEY');
  const c = await dbClient();
  try {
    const r = await c.query(`SELECT ${SELECT_FIELDS} FROM alerts WHERE inc_id = $1`, [inc]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const insights = await generateAlertInsights(row);
    await c.query(
      `UPDATE alerts
          SET ai_summary = $1, ai_recommendation = $2, ai_similarity_hash = $3, updated_at = now()
        WHERE id = $4`,
      [insights.resumen, insights.recomendacion || null, fingerprint(row), row.id]
    );
    return { inc_id: row.inc_id, insights };
  } finally {
    await c.end();
  }
}

// Procesa en lote las alertas sin análisis (o todas con force) en orden de severidad.
// Si el gateway empieza a limitar, corta en vez de quemar la lista entera.
export async function enrichPending(
  opts: { limit?: number; statuses?: string[]; force?: boolean } = {}
): Promise<EnrichBatchResult> {
  if (!aiEnabled()) throw new Error('IA deshabilitada: configura AI_API_KEY');

  const limit = Math.min(50, Math.max(1, Number(opts.limit ?? 10) || 10));
  const params: any[] = [];
  const where: string[] = [];

  if (!opts.force) where.push('ai_summary IS NULL');
  if (opts.statuses?.length) {
    params.push(opts.statuses);
    where.push(`status = ANY($${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const c = await dbClient();
  let incs: string[] = [];
  try {
    params.push(limit);
    const rows = await c.query(
      `SELECT inc_id FROM alerts ${w}
        ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END,
                 detected_at DESC NULLS LAST
        LIMIT $${params.length}`,
      params
    );
    incs = rows.rows.map((r: any) => r.inc_id);
  } finally {
    await c.end();
  }

  const pause = intEnv(process.env.AI_DELAY_MS, 8000);
  const outcomes: EnrichOutcome[] = [];
  let consecutiveFailures = 0;
  let stopped: string | undefined;

  for (const inc of incs) {
    try {
      const out = await enrichAlertByInc(inc);
      outcomes.push({ inc_id: inc, ok: !!out, model: out?.insights?.model });
      consecutiveFailures = 0;
    } catch (e: any) {
      const message = e?.message || 'error desconocido';
      outcomes.push({ inc_id: inc, ok: false, error: message });
      consecutiveFailures = saturating(message) ? consecutiveFailures + 1 : 0;
      if (consecutiveFailures >= 3) {
        stopped = 'gateway saturado: se corta el lote para no agravar el rate limit';
        break;
      }
    }
    if (pause) await delay(pause);
  }

  const ok = outcomes.filter((o) => o.ok).length;
  const c2 = await dbClient();
  let remaining = 0;
  try {
    const r = await c2.query('SELECT count(*)::int AS n FROM alerts WHERE ai_summary IS NULL');
    remaining = r.rows[0]?.n ?? 0;
  } finally {
    await c2.end();
  }

  return {
    requested: incs.length,
    processed: outcomes.length,
    ok,
    failed: outcomes.length - ok,
    remaining,
    stopped,
    outcomes,
  };
}
