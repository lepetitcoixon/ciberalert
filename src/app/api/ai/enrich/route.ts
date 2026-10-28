// GET  /api/ai/enrich — estado del análisis IA (modelo, gateway y pendientes)
// POST /api/ai/enrich — procesa un lote de alertas pendientes de análisis
import { NextRequest, NextResponse } from 'next/server';
import { dbClient } from '@/lib/db';
import { aiEnabled, config } from '@/lib/ai';
import { enrichPending } from '@/lib/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  const c = await dbClient();
  let pending = 0;
  let total = 0;
  try {
    const r = await c.query(
      'SELECT count(*)::int AS total, count(*) FILTER (WHERE ai_summary IS NULL)::int AS pending FROM alerts'
    );
    total = r.rows[0]?.total ?? 0;
    pending = r.rows[0]?.pending ?? 0;
  } finally {
    await c.end();
  }
  const cfg = config();
  return NextResponse.json({
    enabled: aiEnabled(),
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    keyConfigured: !!cfg.apiKey,
    total,
    pending,
    analyzed: total - pending,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    const result = await enrichPending({
      limit: body?.limit,
      statuses: Array.isArray(body?.statuses) ? body.statuses : undefined,
      force: body?.force === true,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'error en el lote' }, { status: 502 });
  }
}
