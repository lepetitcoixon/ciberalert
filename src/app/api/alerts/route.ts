import { NextRequest, NextResponse } from 'next/server';
import { dbClient, mapRow } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('query')?.trim();
  const severities = sp.get('severity')?.split(',').filter(Boolean);
  const statuses = sp.get('status')?.split(',').filter(Boolean);
  const type = sp.get('type');
  const from = sp.get('from');
  const to = sp.get('to');
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const pageSize = Math.min(100, parseInt(sp.get('pageSize') || '20'));

  const where: string[] = [];
  const params: any[] = [];
  const add = (v: any) => { params.push(v); return `$${params.length}`; };

  if (q) {
    const p = add(`%${q}%`);
    where.push(`(inc_id ILIKE ${p} OR title ILIKE ${p} OR description ILIKE ${p})`);
  }
  if (severities?.length) where.push(`severity = ANY(${add(severities)})`);
  if (statuses?.length) where.push(`status = ANY(${add(statuses)})`);
  if (type && type !== 'Todos') where.push(`type = ${add(type)}`);
  if (from) where.push(`detected_at >= ${add(from)}`);
  if (to) where.push(`detected_at <= ${add(to)}`);

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const c = await dbClient();
  try {
    const count = await c.query(`SELECT count(*)::int AS n FROM alerts ${w}`, params);
    const rows = await c.query(
      `SELECT * FROM alerts ${w} ORDER BY detected_at DESC NULLS LAST LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    return NextResponse.json({
      items: rows.rows.map(mapRow),
      total: count.rows[0].n,
      page, pageSize,
      totalPages: Math.ceil(count.rows[0].n / pageSize),
    });
  } finally { await c.end(); }
}

