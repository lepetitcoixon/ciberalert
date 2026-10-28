// POST /api/alerts/[inc]/ai — genera (o regenera) el análisis IA de una alerta
import { NextRequest, NextResponse } from 'next/server';
import { dbClient, mapRow } from '@/lib/db';
import { enrichAlertByInc } from '@/lib/enrich';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ inc: string }> }) {
  const { inc } = await params;
  const id = decodeURIComponent(inc);
  try {
    const out = await enrichAlertByInc(id);
    if (!out) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    const c = await dbClient();
    try {
      const r = await c.query('SELECT * FROM alerts WHERE inc_id = $1', [id]);
      return NextResponse.json(mapRow(r.rows[0]));
    } finally {
      await c.end();
    }
  } catch (e: any) {
    console.error('[AI] enrich', id, e?.message);
    return NextResponse.json({ error: e?.message || 'error generando el análisis' }, { status: 502 });
  }
}
