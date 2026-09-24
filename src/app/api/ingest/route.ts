// POST /api/ingest — puerta interna de ingesta (solo LAN)
// multipart/form-data: files[] (.eml o .csv) | Authorization: Bearer <INGEST_TOKEN>
import { NextRequest, NextResponse } from 'next/server';
import { ingestEmlBuffer, ingestCsvText, authorized, INGEST_TOKEN } from '@/lib/ingest';
import { Client } from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'token invalido' }, { status: 401 });
  }
  const results: any[] = [];
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      const files = form.getAll('files');
      for (const f of files) {
        if (!(f instanceof File)) continue;
        const buf = Buffer.from(await f.arrayBuffer());
        const name = f.name.toLowerCase();
        try {
          if (name.endsWith('.csv')) {
            const r = await ingestCsvText(buf.toString('utf8'));
            results.push({ file: f.name, ...r, parsed: undefined });
          } else {
            const r = await ingestEmlBuffer(buf);
            results.push({ file: f.name, ok: true, inc_id: r.inc_id, created: r.created, action: r.action });
          }
        } catch (e: any) {
          results.push({ file: f.name, ok: false, error: e.message });
        }
      }
    } else if (ct.includes('message/rfc822') || ct.includes('application/octet-stream')) {
      const buf = Buffer.from(await req.arrayBuffer());
      const r = await ingestEmlBuffer(buf);
      results.push({ ok: true, inc_id: r.inc_id, created: r.created, action: r.action });
    } else {
      return NextResponse.json({ error: 'content-type no soportado, manda multipart con files[]' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, token_configured: !!INGEST_TOKEN, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message, results }, { status: 500 });
  }
}
