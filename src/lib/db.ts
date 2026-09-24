import { Client } from 'pg';

export const dynamic = 'force-dynamic';

export async function dbClient() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

// map DB row → shape del front
export function mapRow(r: any) {
  return {
    id: r.inc_id,
    inc_id: r.inc_id,
    title: r.title || '',
    source: r.source || 'csv',
    type: r.type || 'Otro',
    severity: r.severity || 'Low',
    status: r.status || 'Nuevo',
    hostname: r.hostname ? [r.hostname] : [],
    username: r.username ? [r.username] : [],
    ip: r.ip ? [r.ip] : [],
    group: r.group_name ? [r.group_name] : [],
    description: r.description || '',
    file_path: r.file_path || '',
    file_hash: r.file_hash || '',
    url: r.url || '',
    detected_at: r.detected_at ? r.detected_at.toISOString() : r.created_at.toISOString(),
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    actions: [] as any[],
  };
}
