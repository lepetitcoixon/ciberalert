// GET/PATCH /api/alerts/[inc] — detalle y update de una alerta
import { NextRequest, NextResponse } from 'next/server';
import { dbClient, mapRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ inc: string }> }) {
  const { inc } = await params;
  const c = await dbClient();
  try {
    const r = await c.query('SELECT * FROM alerts WHERE inc_id = $1', [decodeURIComponent(inc)]);
    if (!r.rows.length) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    const alert = mapRow(r.rows[0]);
    const actions = await c.query(
      `SELECT id, action, actor, detail, source, created_at FROM alert_actions WHERE alert_id = $1 ORDER BY created_at DESC`,
      [r.rows[0].id]
    );
    (alert as any).actions = actions.rows.map((a: any) => ({
      action: a.action, actor: a.actor, source: a.source,
      detail: a.detail, created_at: a.created_at.toISOString(),
    }));
    return NextResponse.json(alert);
  } finally { await c.end(); }
}

const ALLOWED_STATUS = ['Nuevo', 'En revisión', 'Escalado', 'En espera', 'Cerrado'];
const ALLOWED_ACTIONS = ['Eliminado', 'Escalado', 'Falso positivo', 'Registrado', 'Reiniciado equipo', 'Bloqueado'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ inc: string }> }) {
  const { inc } = await params;
  const body = await req.json().catch(() => ({}));
  const c = await dbClient();
  try {
    const cur = await c.query('SELECT id FROM alerts WHERE inc_id = $1', [decodeURIComponent(inc)]);
    if (!cur.rows.length) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    const alertId = cur.rows[0].id;

    // cambio de estado
    if (body.status && ALLOWED_STATUS.includes(body.status)) {
      await c.query(`UPDATE alerts SET status = $1, updated_at = now() WHERE id = $2`, [body.status, alertId]);
      await c.query(`INSERT INTO alert_actions (alert_id, action, actor, source, detail) VALUES ($1,$2,$3,$4,$5)`,
        [alertId, body.status === 'Cerrado' ? 'Cerrado' : 'Registrado', body.actor || 'ui', 'manual',
         body.status === 'Cerrado' ? 'Cerrada desde UI' : `Estado → ${body.status} desde UI`]);
    }
    // acción nueva (p.ej. Falso positivo → cierra + registra)
    if (body.new_action && ALLOWED_ACTIONS.includes(body.new_action)) {
      await c.query(`INSERT INTO alert_actions (alert_id, action, actor, source, detail) VALUES ($1,$2,$3,$4,$5)`,
        [alertId, body.new_action, body.actor || 'ui', 'manual', body.detail || null]);
      if (body.new_action === 'Falso positivo') {
        await c.query(`UPDATE alerts SET status = 'Cerrado', updated_at = now() WHERE id = $1`, [alertId]);
      } else if (body.new_action === 'Escalado') {
        await c.query(`UPDATE alerts SET status = 'Escalado', updated_at = now() WHERE id = $1`, [alertId]);
      }
    }
    const out = await c.query('SELECT * FROM alerts WHERE id = $1', [alertId]);
    return NextResponse.json(mapRow(out.rows[0]));
  } finally { await c.end(); }
}
