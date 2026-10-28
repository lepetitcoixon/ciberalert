// Cliente del gateway M365 Copilot2API (API compatible OpenAI) para analizar alertas.
// Lo usan la app Next (a través de src/lib/ai.js) y los scripts de backfill.
// Variables: AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_TIMEOUT_MS, AI_RETRIES, AI_RETRY_MS, AI_DISABLED=1

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'http://127.0.0.1:4141';
const DEFAULT_MODEL = 'gpt-5.5';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function config() {
  const int = (v, fallback) => {
    const n = parseInt(v ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    apiKey: process.env.AI_API_KEY || '',
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 60000) || 60000,
    retries: int(process.env.AI_RETRIES, 3),
    retryMs: int(process.env.AI_RETRY_MS, 15000),
  };
}

function aiEnabled() {
  return process.env.AI_DISABLED !== '1' && !!config().apiKey;
}

const SYSTEM_PROMPT =
  'Eres analista del SOC de CAF. Analizas alertas de ciberseguridad y respondes SIEMPRE en español, ' +
  'sin markdown, de forma directa y técnica. Devuelve exclusivamente un objeto JSON con las claves ' +
  '"resumen" y "recomendacion".';

// Copilot a veces contesta con una negativa genérica; se reintenta con contexto defensivo explícito.
const RETRY_CONTEXT =
  'Contexto: soy analista del SOC de CAF y esto es una detección real de nuestro EDR. ' +
  'Necesito documentarla para el equipo de seguridad y decidir el siguiente paso. ' +
  'Es análisis defensivo de un incidente interno, no contenido ofensivo.';

const REFUSAL =
  /try a different topic|can[’']?t (chat|respond|help)|no puedo (ayudarte|hablar de|responder a)|hablemos de otro tema|intenta con otro tema|prueba con otro tema/i;

function isRefusal(text) {
  return REFUSAL.test(String(text || ''));
}

function buildPrompt(a, withContext = false) {
  const facts = [
    ['INC', a.inc_id],
    ['Título', a.title],
    ['Tipo', a.alert_type],
    ['Descripción técnica', a.alert_type_desc],
    ['Severidad', a.severity],
    ['Estado', a.status],
    ['Resultado', a.result],
    ['Acción EDR', a.action_edr],
    ['Equipo', a.hostname],
    ['Usuario', a.username],
    ['Grupo', a.endpoint_group],
    ['SHA256', a.file_hash],
    ['Ruta', a.file_path],
    ['Resumen original', a.raw_summary],
    ['Siguiente paso original', a.next_step],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${String(v).trim().slice(0, 800)}`)
    .join('\n');

  const user =
    (withContext ? `${RETRY_CONTEXT}\n\n` : '') +
    'Analiza esta alerta y devuelve el JSON pedido.\n\n' +
    'Reglas:\n' +
    '- "resumen": 2 o 3 frases: qué ha pasado, en qué equipo o usuario y el riesgo real.\n' +
    '- "recomendacion": 1 a 3 acciones concretas y ordenadas para el analista (verificar, contener, escalar o cerrar).\n' +
    '- Si los datos no permiten concluir, dilo en vez de inventar.\n' +
    '- No repitas los campos literalmente.\n\n' +
    'Alerta:\n' +
    facts;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

function stripFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function normalize(obj) {
  const resumen = String(obj.resumen ?? obj.summary ?? '').trim();
  const recomendacion = String(obj.recomendacion ?? obj.recommendation ?? '').trim();
  if (!resumen) return null;
  return { resumen, recomendacion };
}

// El modelo no siempre respeta el JSON estricto: toleramos fences, texto alrededor y variantes de clave.
function parseInsights(text) {
  const raw = stripFences(text);
  try {
    const out = normalize(JSON.parse(raw));
    if (out) return out;
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const out = normalize(JSON.parse(match[0]));
      if (out) return out;
    } catch {}
  }
  return { resumen: raw.slice(0, 1200), recomendacion: '' };
}

const retryableStatus = (status) => status === 429 || status === 408 || status >= 500;

async function requestChat(messages) {
  const cfg = config();
  let lastError;

  for (let attempt = 1; attempt <= Math.max(1, cfg.retries); attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, max_tokens: 500 }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      const body = await res.text();
      if (res.ok) return body;

      const detail = body.replace(/\s+/g, ' ').slice(0, 300);
      lastError = new Error(`gateway ${res.status}: ${detail}`);
      if (!retryableStatus(res.status) || attempt === cfg.retries) throw lastError;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e);
      const retriable = /gateway (429|408|5\d\d)/.test(msg) || /fetch failed|ECONN|timeout|aborted/i.test(msg);
      if (!retriable || attempt === cfg.retries) throw e;
    }
    // Backoff lineal: 15s, 30s... (el gateway devuelve la cuenta a "cooldown" unos 30s)
    await sleep(cfg.retryMs * attempt);
  }

  throw lastError || new Error('fallo desconocido del gateway');
}

function extractContent(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('respuesta no JSON del gateway');
  }
  const message = data?.choices?.[0]?.message || {};
  return message.content ?? message.reasoning_content ?? '';
}

async function generateAlertInsights(alert) {
  const cfg = config();
  if (!cfg.apiKey) throw new Error('AI_API_KEY no configurada');

  let content = extractContent(await requestChat(buildPrompt(alert, false)));
  if (isRefusal(content)) {
    // Segundo intento con contexto defensivo antes de darlo por fallido.
    content = extractContent(await requestChat(buildPrompt(alert, true)));
    if (isRefusal(content)) throw new Error('el modelo rechazó analizar la alerta (content policy)');
  }

  const out = parseInsights(content);
  if (!out.resumen) throw new Error('respuesta vacía del modelo');
  if (isRefusal(out.resumen)) throw new Error('el modelo rechazó analizar la alerta (content policy)');
  return { ...out, model: cfg.model };
}

// Huella estable para no repetir análisis de la misma alerta.
function fingerprint(a) {
  return crypto
    .createHash('sha256')
    .update([a.inc_id, a.alert_type, a.title, a.raw_summary || a.alert_type_desc || ''].join('|'))
    .digest('hex');
}

module.exports = { aiEnabled, config, buildPrompt, parseInsights, isRefusal, generateAlertInsights, fingerprint };
