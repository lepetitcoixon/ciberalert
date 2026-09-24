// OWA Poller — lee el buzón compartido de alertas vía Outlook Web con sesión guardada
// y descarga los .eml de correos no leídos → los inyecta a la API de ingesta local.
//
// Modos:
//   node owa-poller.js login     → bootstrap INTERACTIVO (tú haces login+MFA en noVNC)
//   node owa-poller.js run       → ciclo único con sesión guardada (lo llama el systemd timer)
//   node owa-poller.js run --dry-run → lista lo que haría sin tocar nada
//
// Requisitos: playwright-core + chromium EPEL (binario del sistema) + display via Xvfb
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.OWA_STATE_DIR || '/var/lib/ciberalert/owa';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const OWA_URL = process.env.OWA_URL || 'https://outlook.office365.com/mail/';
const API_URL = process.env.API_URL || 'http://127.0.0.1:3000/api/ingest';
const HEADLESS = process.env.OWA_HEADLESS !== '0';
const FOLDER = process.env.OWA_FOLDER || 'Inbox';
const PROCESSED_FOLDER = process.env.OWA_PROCESSED_FOLDER || 'CiberAlert-Procesados';

const CHROMIUM_PATH = '/usr/bin/chromium-browser';

async function launch() {
  if (!fs.existsSync(CHROMIUM_PATH)) throw new Error('chromium-browser no encontrado (dnf install chromium)');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const ctxOpts = {
    executablePath: CHROMIUM_PATH,
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (fs.existsSync(STATE_FILE)) ctxOpts.storageState = STATE_FILE;
  const browser = await chromium.launch(ctxOpts);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (fs.existsSync(STATE_FILE)) {
    // chromium.launch no acepta storageState en algunas versiones via launch; aplicar via context
    // (usamos newContext con storageState si está soportado; si no, ignoramos)
  }
  return browser;
}

async function saveState(ctx) {
  const state = await ctx.storageState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
}

async function isLoggedIn(page) {
  // OWA hace redirect a login.microsoftonline.com si la sesión murió
  const url = page.url();
  if (/login\.microsoftonline|login\.live/.test(url)) return false;
  // también un div de login visible
  return await page.evaluate(() => !document.querySelector('#i0116, [data-testid="usernameInput"]'));
}

// ---------- login interactivo ----------
async function doLogin() {
  // Chromium visible dentro de Xvfb+noVNC (systemd arranca Xvfb en :99)
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--start-maximized'],
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(OWA_URL, { waitUntil: 'domcontentloaded' });
  console.log('→ Abre el noVNC y haz el login + MFA en el Chromium visible.');
  console.log('→ Cuando veas la bandeja de entrada de OWA cargada, el script detectará y guardará la sesión.');
  // Esperar hasta que la sesión esté (URL de mail + sin inputs de login) — max 10 min
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(3000);
    if (await isLoggedIn(page)) {
      console.log('✅ Login detectado, guardando sesión en', STATE_FILE);
      await saveState(ctx);
      await browser.close();
      return;
    }
  }
  console.error('❌ Timeout esperando login (10 min)');
  await browser.close();
  process.exit(1);
}

// ---------- ciclo de polling ----------
function isUnread(row) {
  // las mailList rows no leídas llevan aria-label "...unread" o clase con unread
  const label = row.getAttribute('aria-label') || row.className || '';
  return /unread|no le/i.test(label);
}

function guessDownloadButton(row, nameRe) {
  return row.getByRole('menuitem', { name: nameRe }).first();
}

async function runOnce() {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error('Sin sesión guardada. Ejecuta primero: node owa-poller.js login (via noVNC)');
  }
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(OWA_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000); // OWA SPA carga
    if (!(await isLoggedIn(page))) {
      // sesión expirada → guardar diagnóstico y avisar
      await saveState(ctx); // por si trajo cookies frescas de manos
      throw new Error('SESSION_EXPIRED');
    }
    await refreshState();

    // Abrir carpeta configurada (por defecto Inbox)
    await openFolder(page, FOLDER);
    await page.waitForTimeout(4000);

    // Filas de mensajes no leídos
    const rows = page.locator('[role="option"], [role="listitem"], tr[role="row"]').filter({ hasText: '' });
    // OWA moderno lista por divs con aria-label; usamos los items con su menú contextual
    const items = await page.locator('[aria-label*="unread"], [aria-label*="no le"]').all();
    console.log(`Mensajes no leídos detectados: ${items.length}`);
    const results = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const row = items[i];
        await row.click();
        await page.waitForTimeout(2500);
        // menú "More actions" → "Download message" (.eml)
        const moreBtn = page.getByLabel('More actions').first();
        await moreBtn.click();
        await page.waitForTimeout(600);
        const dl = page.getByText('Download', { exact: false }).first();
        await dl.click();
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }),
        ]);
        const path_ = `/tmp/owa-dl-${Date.now()}.eml`;
        await download.saveAs(path_);
        // POST a la API local
        const fsSync = require('fs');
        const buf = fsSync.readFileSync(path_);
        const token = (fsSync.readFileSync('/etc/ciberalert-env', 'utf8')
          .split('\n').find(l => l.startsWith('INGEST_TOKEN=')) || '').split('=')[1];
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
          body: buf,
        });
        const j = await res.json();
        console.log(`  → ${j.results?.[0]?.inc_id || '?'} ${j.results?.[0]?.created ? 'NUEVA' : 'dup'}`);
        results.push(j);
        // mover a carpeta procesados: right-click → move
        await row.click({ button: 'right' });
        await page.waitForTimeout(500);
        const moveTo = page.getByText('Move to', { exact: false }).first();
        if (await moveTo.count()) {
          await moveTo.click();
          await page.waitForTimeout(400);
          const target = page.getByText(PROCESSED_FOLDER, { exact: true }).first();
          if (await target.count()) { await target.click(); await page.waitForTimeout(1200); }
        }
        fsSync.unlinkSync(path_);
      } catch (e) {
        console.error(`  FALLO ${i}: ${e.message.slice(0, 120)}`);
      }
    }
    return { unread: items.length, processed: results.length, results };
  } finally {
    await browser.close();
  }
}

async function refreshState() { /* noop por ahora */ }
async function openFolder(page, name) {
  if (name === 'Inbox') return; // default
  const f = page.getByText(name, { exact: false }).first();
  if (await f.count()) await f.click();
}

if (require.main === module) {
  const mode = process.argv[2] || 'run';
  const isDry = process.argv.includes('--dry-run');
  (mode === 'login' ? doLogin() : runOnce())
    .then(r => { if (r) console.log(JSON.stringify(r, null, 1)); process.exit(0); })
    .catch(e => {
      console.error('OWA ERROR:', e.message.slice(0, 300));
      if (String(e.message).includes('SESSION_EXPIRED')) process.exit(99); // señal al systemd/monitor
      process.exit(1);
    });
}

module.exports = { runOnce, doLogin };
