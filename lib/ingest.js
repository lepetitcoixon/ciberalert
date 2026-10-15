// Librería de ingesta compartida: EML (buffer) y CSV → DB. La usan el CLI, la API y el watcher.
const { Client } = require('pg');

const LIB_DIR = __dirname;
let _parseEmlBuffer = null;
function getParser() {
  if (!_parseEmlBuffer) {
    _parseEmlBuffer = require('./parse-eml').parseEmlBuffer;
  }
  return _parseEmlBuffer;
}

const INGEST_TOKEN = process.env.INGEST_TOKEN || null; // si no hay token, la API queda abierta (solo LAN)

function getToken(req) {
  // NextRequest (App Router) expone headers solo via .get(); Node req los trae como objeto
  const get = typeof req.headers?.get === 'function'
    ? (k) => req.headers.get(k)
    : (k) => req.headers?.[k] || req.headers?.[k.toLowerCase()];
  const h = get('authorization') || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  return bearer || get('x-ingest-token') || null;
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
  const p = await getParser()(buf);
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
         detected_at, hostname, username, action_edr, raw_summary, next_step, soc_url, vt_url, endpoint_group)
       VALUES ($1,'csv',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (inc_id) DO UPDATE SET
         status = EXCLUDED.status, result = EXCLUDED.result,
         endpoint_group = COALESCE(EXCLUDED.endpoint_group, alerts.endpoint_group),
         updated_at = now()
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
       (r['Virustotal'] || '').trim() || null,
       (r['Grupo'] || '').trim() || null]);
    if (res.rows[0].inserted) inserted++; else updated++;
  }
  return { ok: true, inserted, updated, total: rows.length, errors };
}

// ---------- JSON (Power Automate / integraciones externas) ----------
function pick(o, keys) {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

const SEVERITY_MAP = {
  critical: 'Critical', critica: 'Critical', 'crítica': 'Critical', critico: 'Critical', 'crítico': 'Critical',
  high: 'High', alta: 'High', alto: 'High',
  medium: 'Medium', media: 'Medium', medio: 'Medium',
  low: 'Low', baja: 'Low', bajo: 'Low',
  info: 'Info', informativa: 'Info', informativo: 'Info',
};
const STATUS_MAP = {
  nuevo: 'Nuevo', abierto: 'Nuevo', abierta: 'Nuevo', open: 'Nuevo',
  'en proceso': 'En Proceso', 'en curso': 'En Proceso', proceso: 'En Proceso', 'in progress': 'En Proceso',
  'en revisión': 'En Proceso', 'en revision': 'En Proceso', revision: 'En Proceso', 'revisión': 'En Proceso',
  escalado: 'Escalado', escalated: 'Escalado',
  solucionado: 'Solucionado', cerrado: 'Solucionado', resuelto: 'Solucionado', closed: 'Solucionado',
  pentest: 'Pentest',
};

function normSeverity(v) {
  const s = String(v ?? '').trim();
  if (!s || /^no\s+informado$/i.test(s) || /^desconocid/i.test(s)) return null;
  return SEVERITY_MAP[s.toLowerCase()] || 'Medium';
}
function normStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return STATUS_MAP[s.toLowerCase()] || s;
}
function asText(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || null;
  const t = String(v).replace(/""/g, '"').trim();
  return t || null;
}
function asList(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) {
    const a = v.filter((x) => x !== null && x !== undefined && x !== '');
    return a.length ? a.map(String) : null;
  }
  const a = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  return a.length ? a : null;
}
function asUser(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.filter(Boolean).join(', ') || null;
  return parseUserList(v);
}

// Permite enviar valores arbitrarios sin problemas de escapado: cualquier clave acabada en *_b64
// se decodifica de Base64 (UTF-8) al campo equivalente (title_b64 -> title).
function expandB64Fields(o) {
  const out = { ...o };
  for (const k of Object.keys(o)) {
    if (k.endsWith('_b64') && typeof o[k] === 'string') {
      const base = k.slice(0, -4);
      if (out[base] === undefined || out[base] === null || out[base] === '') {
        try { out[base] = Buffer.from(o[k], 'base64').toString('utf8'); } catch { /* ignora */ }
      }
    }
  }
  return out;
}

// severity: usa la proporcionada; si no, la deduce de la etiqueta [HIGH]/[MEDIUM]/... del asunto/resumen.
function deriveSeverity(raw) {
  const given = normSeverity(pick(raw, ['severity', 'severidad']));
  if (given) return given;
  const hay = [asText(pick(raw, ['title', 'titulo'])), asText(pick(raw, ['raw_summary', 'resumen']))]
    .filter(Boolean).join(' ');
  const m = hay.match(/\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]/i);
  return m ? normSeverity(m[1]) : null;
}

// inc_id: usa el proporcionado si ya es un INC...; si no, lo busca en title/resumen; si no hay, genera uno.
function deriveIncId(raw) {
  const given = asText(pick(raw, ['inc_id', 'incidencia', 'inc', 'id']));
  if (given && /^INC\d/i.test(given.trim())) return given.trim().toUpperCase();
  const hay = [given, asText(pick(raw, ['title', 'titulo'])), asText(pick(raw, ['raw_summary', 'resumen']))]
    .filter(Boolean).join(' ');
  const m = hay.match(/INC\d{6,}/);
  if (m) return m[0].toUpperCase();
  return given ? given.trim() : ('PA-' + Date.now());
}

// Acepta un objeto, un array de objetos, o { alerts: [...] } / { items: [...] }
async function ingestJson(payload, client) {
  client = client || await db();
  let list = payload;
  if (payload && !Array.isArray(payload)) list = payload.alerts || payload.items || [payload];
  if (!Array.isArray(list)) list = [list];

  const results = [];
  for (const rawInput of list) {
    if (!rawInput || typeof rawInput !== 'object') continue;
    const raw = expandB64Fields(rawInput);
    try {
      const inc = deriveIncId(raw);
      const res = await client.query(
        `INSERT INTO alerts
          (inc_id, source, title, alert_type, alert_type_desc, severity, status, result,
           detected_at, hostname, endpoint_type, os_name, ip_addresses, domain, username,
           endpoint_group, action_edr, file_path, file_hash, vt_url, soc_url,
           raw_summary, next_step, email_message_id)
         VALUES ($1,'manual',$2,$3,$4,$5,COALESCE($6::text,'Nuevo'),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (inc_id) DO UPDATE SET
           title            = COALESCE(EXCLUDED.title, alerts.title),
           alert_type       = COALESCE(EXCLUDED.alert_type, alerts.alert_type),
           alert_type_desc  = COALESCE(EXCLUDED.alert_type_desc, alerts.alert_type_desc),
           severity         = COALESCE(EXCLUDED.severity, alerts.severity),
           status           = COALESCE($6::text, alerts.status),
           result           = COALESCE(EXCLUDED.result, alerts.result),
           detected_at      = COALESCE(EXCLUDED.detected_at, alerts.detected_at),
           hostname         = COALESCE(EXCLUDED.hostname, alerts.hostname),
           endpoint_type    = COALESCE(EXCLUDED.endpoint_type, alerts.endpoint_type),
           os_name          = COALESCE(EXCLUDED.os_name, alerts.os_name),
           ip_addresses     = COALESCE(EXCLUDED.ip_addresses, alerts.ip_addresses),
           domain           = COALESCE(EXCLUDED.domain, alerts.domain),
           username         = COALESCE(EXCLUDED.username, alerts.username),
           endpoint_group   = COALESCE(EXCLUDED.endpoint_group, alerts.endpoint_group),
           action_edr       = COALESCE(EXCLUDED.action_edr, alerts.action_edr),
           file_path        = COALESCE(EXCLUDED.file_path, alerts.file_path),
           file_hash        = COALESCE(EXCLUDED.file_hash, alerts.file_hash),
           vt_url           = COALESCE(EXCLUDED.vt_url, alerts.vt_url),
           soc_url          = COALESCE(EXCLUDED.soc_url, alerts.soc_url),
           raw_summary      = COALESCE(EXCLUDED.raw_summary, alerts.raw_summary),
           next_step        = COALESCE(EXCLUDED.next_step, alerts.next_step),
           email_message_id = COALESCE(EXCLUDED.email_message_id, alerts.email_message_id),
           updated_at       = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          inc,
          asText(pick(raw, ['title', 'titulo', 'título'])),
          asText(pick(raw, ['alert_type', 'tipo'])),
          asText(pick(raw, ['alert_type_desc', 'descripcion', 'descripción', 'description'])),
          deriveSeverity(raw),
          normStatus(pick(raw, ['status', 'estado'])),
          asText(pick(raw, ['result', 'resultado'])),
          parseDate(pick(raw, ['detected_at', 'detectedAt', 'fecha_deteccion', 'fecha'])),
          asText(pick(raw, ['hostname', 'equipo'])),
          asText(pick(raw, ['endpoint_type'])),
          asText(pick(raw, ['os_name', 'so'])),
          asList(pick(raw, ['ip_addresses', 'ips', 'ip'])),
          asText(pick(raw, ['domain', 'dominio'])),
          asUser(pick(raw, ['username', 'usuario'])),
          asText(pick(raw, ['endpoint_group', 'grupo'])),
          asText(pick(raw, ['action_edr', 'accion_edr', 'acción_edr'])),
          asText(pick(raw, ['file_path', 'ruta'])),
          asText(pick(raw, ['file_hash', 'hash', 'sha256'])),
          asText(pick(raw, ['vt_url', 'virustotal'])),
          asText(pick(raw, ['soc_url', 'enlace_soc'])),
          asText(pick(raw, ['raw_summary', 'resumen'])),
          asText(pick(raw, ['next_step', 'siguiente_paso'])),
          asText(pick(raw, ['email_message_id'])),
        ]
      );
      results.push({ ok: true, inc_id: inc, alert_id: res.rows[0].id, created: res.rows[0].inserted });
    } catch (e) {
      results.push({ ok: false, error: e.message });
    }
  }
  return results;
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

module.exports = { ingestEmlBuffer, ingestCsvText, ingestJson, parseCsv, authorized, INGEST_TOKEN };
