// Ingesta EML → DB: parsea y upserta la alerta + registra la acción humana del reply
// Uso: node scripts/ingest-eml.js /ruta/alerta.eml
const fs = require('fs');
const { Client } = require('pg');
const { parseEml } = require('./parse-eml');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node ingest-eml.js <archivo.eml>'); process.exit(1); }
  const p = await parseEml(file);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const machine = Object.values(p.machines)[0] || {};
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
  const severity = p.severity || 'Medium';
  const vals = [
    p.inc_id || ('EML-' + Date.now()),
    p.title || p.alert_name,
    p.security.name || p.alert_name?.split(' - ')[0] || 'Desconocido',
    p.description || p.security.description,
    severity,
    p.is_reply ? 'En Proceso' : 'Nuevo',       // una respuesta humana implica que ya se está trabajando
    p.detected_at,
    p.hostnames[0] || null,
    machine.endpoint_type || null,
    machine.os || null,
    machine.ip ? machine.ip.split(', ') : null,
    machine.domain || null,
    machine.users || null,
    machine.group || null,
    p.security.file_path || null,
    p.security.sha256 || null,
    p.soc_url,
    p.message_id,
    p.description || null,
  ];
  const res = await client.query(q, vals);
  const alertId = res.rows[0].id;
  const isNew = res.rows[0].inserted;

  // La respuesta humana del hilo → alert_actions
  if (p.is_reply && p.reply_action) {
    const body = p.reply_action.replace(/Un saludo,[\s\S]*$/, '').trim();
    if (body && body.length > 2) {
      const actor = (p.from?.match(/<([^>]+)>/) || [])[1] || p.from;
      await client.query(
        `INSERT INTO alert_actions (alert_id, action, actor, detail, source)
         VALUES ($1,'respuesta_email',$2,$3,'email')`,
        [alertId, actor, body]
      );
    }
  }

  console.log(`EML ingest: INC=${p.inc_id} alert_id=${alertId} nueva=${isNew} reply_action="${p.reply_action ? 'registrada' : 'n/a'}"`);
  await client.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
