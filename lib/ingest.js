// Librería de ingesta compartida: EML (buffer) y CSV → DB. La usan el CLI, la API y el watcher.
const { Client } = require('pg');
const { parseEmlBuffer } = require('./parse-eml');

const INGEST_TOKEN = process.env.INGEST_TOKEN || null; // si no hay token, la API queda abierta (solo LAN)

function getToken(req) {
  const h = req.headers['authorization'] || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  return bearer || req.headers['x-ingest-token'] || null;
}
function authorized(req) {
  if (!INGEST_TOKEN) return true; // sin token configurado = sin auth (LAN interna)
  return getToken(req) === INGEST_TOKEN;
}

async function db() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

// ---------- EML ----------
async function ingestEmlBuffer(buf, client) {
  client = client || await db();
  const p = await parseEmlBuffer(buf);
  const machine = Object.values(p.machines || {})[0] || {};

  const q = `INSERT INTO alerts
    (inc_id, source, title, alert_type, alert_type_desc, severity, status,
     detected_at, hostname, endpoint_type, os_name, ip_addresses, domain,
     username, endpoint_group, file_path, file_hash, soc_url,
     email_message_id, raw_summary)
    VALUES ($1,'email',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (inc_id) DO UPDATE SET
      alert_type_desc = COALESCE(EXCLUDED.alert_type_desc, alerts.alert_type_desc),
      file_hash      = COALESCE(EXCLUDED.file_hash, alerts.file_hash),
      soc_url        = COALESCE(EXCLUDED.soc_url, alerts.soc_url),
      detected_at    = COALESCE(EXCLUDED.detected_at, alerts.detected_at),
      updated_at     = now()
    RETURNING id, (xmax = 0) AS inserted`;

  const vals = [
    p.inc_id || ('EML-' + Date.now()),
    p.title || p.alert_name,
    p.security?.name || p.alert_name?.split(' - ')[0] || 'Desconocido',
    p.description || p.security?.description || null,
    p.severity || 'Medium',
    p.is_reply ? 'En Proceso' : 'Nuevo',
    p.detected_at,
    p.hostnames[0] || null,
    machine.endpoint_type || null,
    machine.os || null,
    machine.ip ? machine.ip.split(', ') : null,
    machine.domain || null,
    machine.users || null,
    machine.group || null,
    p.security?.file_path || null,
    p.security?.sha256 || null,
    p.soc_url,
    p.message_id,
    p.description || null,
  ];
  const res = await client.query(q, vals);
  const alertId = res.rows[0].id;
  const isNew = res.rows[0].inserted;

  let actionLogged = null;
  if (p.is_reply && p.reply_action) {
    const body = p.reply_action.replace(/Un saludo,[\s\S]*$/, '').trim();
    if (body && body.length > 2) {
      const actor = (p.from?.match(/<([^>]+)>/) || [])[1] || p.from;
      // dedupe de acciones idénticas para la misma alerta
      const dup = await client.query(
        `SELECT 1 FROM alert_actions WHERE alert_id=$1 AND detail=$2 LIMIT 1`, [alertId, body]);
      if (dup.rowCount === 0) {
        await client.query(
          `INSERT INTO alert_actions (alert_id, action, actor, detail, source)
           VALUES ($1,'respuesta_email',$2,$3,'email')`, [alertId, actor, body]);
        actionLogged = body;
      }
    }
  }
  return { ok: true, inc_id: p.inc_id, alert_id: alertId, created: isNew, action: actionLogged, parsed: p };
}

// ---------- CSV (mismo upsert del import-csv, reutilizable desde API) ----------
function splitAlertType(raw) {
  if (!raw) return { name: null, desc: null };
  const m = raw.match(/^(.*?)(?:\s*-\s*\d+)?Description(.*)$/s);
  if (m) return { name: m[1].trim(), desc: m[2].trim() };
  return { name: raw.trim(), desc: null };
}
function parseDate(s) {
  const t = (s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12, 0, 0));
  const d = new Date(t);
  return isNaN(d) ? null : d;
}
function parseUserList(raw) {
  if (!raw) return null;
  const t = raw.replace(/""/g, '"').trim();
  if (t.startsWith('[')) {
    try { return JSON.parse(t).filter(Boolean).join(', '); } catch { return t; }
  }
  return t;
}

async function ingestCsvText(text, client) {
  client = client || await db();
  const { rows, errors } = parseCsv(text);
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const inc = (r['Título'] || r['Incidencia'] || '').trim();
    if (!inc.startsWith('INC')) continue;
    const { name, desc } = splitAlertType(r['TipoAlerta']);
    const res = await client.query(
      `INSERT INTO alerts
        (inc_id, source, title, alert_type, alert_type_desc, severity, status, result,
         detected_at, hostname, username, action_edr, raw_summary, next_step, soc_url, vt_url)
       VALUES ($1,'csv',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (inc_id) DO UPDATE SET
         status = EXCLUDED.status, result = EXCLUDED.result, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [inc, inc, name, desc,
       (r['Severidad '] || '').trim() || null,
       (r['Estado  '] || '').trim() || null,
       (r['Resultado'] || '').trim() || null,
       parseDate(r['FechaDeteccionUTC ']),
       (r['Equipo '] || '').trim() || null,
       parseUserList(r['Usuario']),
       (r['AccionEDR'] || '').trim() || null,
       (r['Resumen'] || '').trim() || null,
       (r['SiguientePaso'] || '').trim() || null,
       (r['EnlaceSOC'] || '').trim() || null,
       (r['Virustotal'] || '').trim() || null]);
    if (res.rows[0].inserted) inserted++; else updated++;
  }
  return { ok: true, inserted, updated, total: rows.length, errors };
}

// Parser CSV con quotes anidados (sin dependencias)
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  const data = rows.filter(r => r.length > 1).map(r => {
    const o = {}; header.forEach((h, i) => o[h.trim()] = r[i] || ''); return o;
  });
  return { rows: data, errors: [] };
}

module.exports = { ingestEmlBuffer, ingestCsvText, parseCsv, authorized, INGEST_TOKEN };
