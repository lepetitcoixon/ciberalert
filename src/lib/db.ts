import { Client } from 'pg';
import type { Alert } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function dbClient() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

const iso = (d: any, fallback?: any) => {
  const v = d || fallback;
  return v ? new Date(v).toISOString() : new Date().toISOString();
};

const asList = (v: any): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean) as string[];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
};

// map DB row (schema real) → shape del front
export function mapRow(r: any): Alert {
  return {
    inc_id: r.inc_id,
    title: r.title || r.inc_id,
    source: r.source || 'csv',
    type: r.alert_type || 'Otro',
    severity: r.severity || 'Low',
    status: r.status || 'Nuevo',
    result: r.result || null,
    action_edr: r.action_edr || null,
    next_step: r.next_step || null,
    vt_url: r.vt_url || null,
    hostname: r.hostname ? [r.hostname] : [],
    username: asList(r.username),
    ip: asList(r.ip_addresses),
    group: r.endpoint_group ? [r.endpoint_group] : [],
    description: r.raw_summary || r.alert_type_desc || '',
    file_path: r.file_path || '',
    file_hash: r.file_hash || '',
    url: r.soc_url || r.vt_url || '',
    detected_at: iso(r.detected_at, r.created_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at, r.created_at),
    actions: [],
  };
}
