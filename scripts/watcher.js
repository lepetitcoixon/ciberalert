// Watcher de carpeta inbox: ingiere cualquier .eml que aparezca en /var/spool/ciberalert/inbox
// Requiere chokidar (npm i chokidar). Se registra como servicio systemd ciberalert-watcher.
// Convive con la API: TODO pasa por lib/ingest.js → dedupe por INC garantizado.
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { ingestEmlBuffer } = require('../lib/ingest');

const INBOX = process.env.CIBERALERT_INBOX || '/var/spool/ciberalert/inbox';
const PROCESSED = process.env.CIBERALERT_PROCESSED || '/var/spool/ciberalert/processed';
const FAILED = process.env.CIBERALERT_FAILED || '/var/spool/ciberalert/failed';

[INBOX, PROCESSED, FAILED].forEach(d => fs.mkdirSync(d, { recursive: true }));

function db() {
  return new Client({ connectionString: process.env.DATABASE_URL });
}

const watcher = chokidar.watch(path.join(INBOX, '*.eml'), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 } });

watcher.on('add', async (file) => {
  const client = db();
  try {
    await client.connect();
    const buf = fs.readFileSync(file);
    const r = await ingestEmlBuffer(buf, client);
    console.log(`[${new Date().toISOString()}] INGEST ${path.basename(file)} → INC=${r.inc_id} ${r.created ? 'NUEVA' : 'upsert'}${r.action ? ' acción: ' + r.action : ''}`);
    const dest = path.join(PROCESSED, `${Date.now()}-${path.basename(file)}`);
    fs.renameSync(file, dest);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] FALLO ${file}: ${e.message}`);
    const dest = path.join(FAILED, `${Date.now()}-${path.basename(file)}`);
    try { fs.renameSync(file, dest); } catch {}
  } finally {
    try { await client.end(); } catch {}
  }
});

watcher.on('error', e => console.error('WATCHER ERROR:', e.message));
console.log(`👀 CiberAlert watcher escuchando eml en ${INBOX} → ${PROCESSED}`);
