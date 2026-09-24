// Importador CSV del SharePoint de alertas → PostgreSQL
// Uso: node scripts/import-csv.js /ruta/registro.csv
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Limpieza de TipoAlerta: separa "Nombre - 123DescriptionTexto..." → {name, desc}
function splitAlertType(raw) {
  if (!raw) return { name: null, desc: null };
  const m = raw.match(/^(.*?)(?:\s*-\s*\d+)?Description(.*)$/s);
  if (m) return { name: m[1].trim(), desc: m[2].trim() };
  return { name: raw.trim(), desc: null };
}

function parseDate(s) {
  const t = (s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY (en-US export)
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], 12, 0, 0));
  const d = new Date(t);
  return isNaN(d) ? null : d;
}

function parseUserList(raw) {
  if (!raw) return null;
  // El CSV mete listas estilo ["CAFNT\\X","NT AUTHORITY\\SYSTEM"] dobladas
  const t = raw.replace(/""/g, '"').trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      return arr.filter(Boolean).join(', ');
    } catch { return t; }
  }
  return t;
}

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node import-csv.js <archivo.csv>'); process.exit(1); }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = csvToArray(fs.readFileSync(file, 'utf8'));
  let inserted = 0, skipped = 0, updated = 0;

  for (const r of rows) {
    const inc = (r['Título'] || r['Incidencia'] || '').trim();
    if (!inc || !inc.startsWith('INC')) { skipped++; continue; }
    const { name, desc } = splitAlertType(r['TipoAlerta']);
    const q = `INSERT INTO alerts
      (inc_id, source, title, alert_type, alert_type_desc, severity, status, result,
       detected_at, hostname, username, action_edr, raw_summary, next_step, soc_url, vt_url)
      VALUES ($1,'csv',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (inc_id) DO UPDATE SET
        status = EXCLUDED.status, result = EXCLUDED.result, updated_at = now()
      RETURNING (xmax = 0) AS inserted`;
    const vals = [
      inc,
      inc,
      name, desc,
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
    ];
    const res = await client.query(q, vals);
    if (res.rows[0].inserted) inserted++; else updated++;
  }
  console.log(`Import CSV: ${inserted} nuevas, ${updated} actualizadas, ${skipped} saltadas de ${rows.length} filas`);
  await client.end();
})();

// Parser CSV con quotes anidados (no usa librería externa a propósito)
function csvToArray(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter(r => r.length > 1).map(r => {
    const o = {}; header.forEach((h, i) => o[h] = r[i] || ''); return o;
  });
}
