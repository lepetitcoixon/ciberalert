// Watcher de carpeta inbox: ingiere cualquier .eml que aparezca en /var/spool/ciberalert/inbox
// Usa fs.watch nativo (chokidar v5 no dispara eventos en glibc EL8 — probado).
// Se registra como servicio systemd ciberalert-watcher. Todo pasa por lib/ingest.js.
const fs = require('fs');
const path = require('path');
const { ingestEmlBuffer } = require('../lib/ingest');

const INBOX = process.env.CIBERALERT_INBOX || '/var/spool/ciberalert/inbox';
const PROCESSED = process.env.CIBERALERT_PROCESSED || '/var/spool/ciberalert/processed';
const FAILED = process.env.CIBERALERT_FAILED || '/var/spool/ciberalert/failed';

[INBOX, PROCESSED, FAILED].forEach(d => fs.mkdirSync(d, { recursive: true }));

// fs.watch vigila el DIRECTORIO: cheap, fiable, y dispara en create/rename
fs.watch(INBOX, { persistent: true }, (event, filename) => {
  if (!filename || !filename.endsWith('.eml')) return;
  const file = path.join(INBOX, filename);
  // pequeña espera para que la copia termine (awaitWriteFinish casero)
  setTimeout(async () => {
    try {
      // ignoreInitial no aplica: dedupe por INC garantiza no duplicar
      const buf = fs.readFileSync(file);
      if (buf.length < 20) return; // archivo aún en escritura
      await ingestEmlFile(file, buf);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`[${ts()}] FALLO ${filename}: ${e.message}`);
    }
  }, 1000);
});

async function ingestEmlFile(file, buf) {
  const client = new (require('pg').Client)({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const r = await ingestEmlBuffer(buf, client);
    console.log(`[${ts()}] INGEST ${path.basename(file)} → INC=${r.inc_id} ${r.created ? 'NUEVA' : 'upsert'}${r.action ? ' acción:' + r.action : ''}`);
    fs.renameSync(file, path.join(PROCESSED, `${Date.now()}-${path.basename(file)}`));
  } catch (e) {
    console.error(`[${ts()}] FALLO ${file}: ${e.message}`);
    try { fs.renameSync(file, path.join(FAILED, `${Date.now()}-${path.basename(file)}`)); } catch {}
  } finally {
    try { await client.end(); } catch {}
  }
}

function ts() { return new Date().toISOString(); }
console.log(`👀 CiberAlert watcher (fs.watch) escuchando ${INBOX} → ${PROCESSED}`);
