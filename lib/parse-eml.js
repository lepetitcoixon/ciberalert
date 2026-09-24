// Parser EML de alertas SOC (Telefonica Tech / Cortex XDR) → objeto estructurado
// Uso: node scripts/parse-eml.js /ruta/alerta.eml
const fs = require('fs');
const { simpleParser } = require('mailparser');

function clean(s) {
  if (!s) return null;
  return s.replace(/\s+/g, ' ').trim();
}

// Desofusca urldefense.com/v3/__URL__...__
function unwrapUrldefense(u) {
  if (!u) return null;
  const m = u.match(/urldefense\.com\/v3\/__(.*?);/);
  if (m) return m[1].replace(/[\\']+$/, '');
  return u;
}

// Lista estilo "['172.22.40.31']" → "172.22.40.31" | "'a','b'" → "a, b"
function parseBracketList(s) {
  if (!s) return null;
  const items = [...s.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] || m[2]);
  const joined = items.length ? items.join(', ') : clean(s);
  return joined ? joined.replace(/\\\\/g, '\\') : null;
}

function extractInc(subject) {
  const m = (subject || '').match(/\[(INC\d+)\]/i);
  return m ? m[1].toUpperCase() : null;
}
function extractSeverity(subject) {
  const m = (subject || '').match(/\[(HIGH|MEDIUM|LOW|INFO)\]/i);
  return m ? m[1][0] + m[1].slice(1).toLowerCase() : null;
}

async function parseEml(filePath) {
  const buf = fs.readFileSync(filePath);
  return parseEmlBuffer(buf);
}

async function parseEmlBuffer(buf) {
  const parsed = await simpleParser(buf);
  const out = {
    message_id: parsed.messageId || null,
    from: parsed.from?.text || null,
    to: parsed.to?.text || null,
    date: parsed.date ? parsed.date.toISOString() : null,
    subject: parsed.subject || null,
    inc_id: extractInc(parsed.subject),
    severity: extractSeverity(parsed.subject),
    title: null, alert_name: null, description: null,
    detected_at: null, hostnames: [], soc_url: null,
    attachments: [], machines: {}, security: {},
    reply_action: null,
    is_reply: /^(re|fw|fwd)\s*:/i.test(parsed.subject || ''),
  };

  out.title = clean((parsed.subject || '').replace(/^(re|fw|fwd)\s*:\s*/i, '').replace(/\[[^\]]*\]/g, ''));

  let text = parsed.text || '';
  const html = parsed.html || '';
  // Quita banners Proofpoint (basura intercalada)
  text = text.replace(/ZjQcmQRYFpfptBanner[\s\S]*?ZjQcmQRYFpfptBannerEnd/g, '');

  // Campos clave (preferir bullets "*   Campo: valor"; fallback a labels pegados)
  const dm = text.match(/\*\s+Fecha de Detecci[oó]n\s*:\s*([^\n]+)/) ||
             text.match(/Fecha de Detecci[oó]n\s*:\s*([^\n]+)/);
  if (dm) {
    // Outlook inserta espacios raros (hair-space): dejar solo [0-9T:-Z]
    const fixed = dm[1].replace(/[^0-9T:\-Zz]/g, '');
    const d = new Date(fixed);
    if (!isNaN(d)) out.detected_at = d.toISOString();
  }

  const nm = text.match(/\*\s+Nombre\s*:\s*([^\n]+)/) ||
             text.match(/Nombre\s*:\s*([^\n]+?)(?=Descripci[oó]n|Severidad|Equipo|$)/s);
  out.alert_name = nm ? clean(nm[1]) : null;

  const dsm = text.match(/\*\s+Descripci[oó]n\s*:\s*([\s\S]*?)(?=\n\s*\*\s+Severidad)/i) ||
              text.match(/Descripci[oó]n\s*:\s*([\s\S]*?)(?=\n\s*Severidad|\n\s*Equipo|$)/i);
  out.description = dsm ? clean(dsm[1]) : null;

  // Equipos mentionados en "Equipo(s):" y en bloques de máquina
  const eq = text.match(/Equipo\(s?\)\s*:\s*([^\n]+)/);
  if (eq) out.hostnames.push(...eq[1].split(/[,;]\s*/).map(h => h.trim()).filter(Boolean));

  // URL portal SOC
  const urlM = (html.match(/https:\/\/urldefense\.com\/v3\/__https:\/\/cybersecurity\.telefonica\.com[^"'\s<>]+/) ||
                text.match(/https:\/\/[^\s<]*cybersecurity\.telefonica\.com[^\s<]+/));
  if (urlM) out.soc_url = unwrapUrldefense(urlM[0]).replace(/__$/, '');

  // Bloques de máquinas: trocear por "Endpoint name"
  const parts = text.split(/(?=[A-Za-z0-9\-_\.]+\s*\n\s*Endpoint name)/g).filter(p => p.includes('Endpoint name'));
  for (const part of parts) {
    const field = (label) => {
      const f = part.match(new RegExp(label + '\\s+([^\\n]+)'));
      return f ? clean(f[1]) : null;
    };
    const hostname = field('Endpoint kindName') || part.match(/^([A-Za-z0-9\-_\.]+)\s*\n\s*Endpoint name\s+([^\n]+)/m)?.[2] || part.match(/\n\s*Endpoint name\s+([^\n]+)/)?.[1];
    if (!hostname) continue;
    const h = clean(hostname);
    if (out.machines[h]) continue;  // dedupe
    out.machines[h] = {
      hostname: h,
      endpoint_type: field('Endpoint type'),
      os: field('Operating system'),
      domain: field('Domain'),
      alias: field('Alias'),
      group: parseBracketList(field('Group name')),
      ip: parseBracketList(field('Ip')),
      public_ip: field('Public ip'),
      users: parseBracketList(field('Users')),
      tags: parseBracketList(field('Server tags')),
    };
    if (!out.hostnames.includes(h)) out.hostnames.push(h);
  }
  // alias/grupo/usuario global = del primero si solo hay una máquina
  const first = Object.values(out.machines)[0];
  if (first) { out.endpoint_group = first.group; out.username = first.users; out.os_name = first.os; out.ip_addresses = first.ip; }

  // Bloque "Información de seguridad"
  const secIdx = text.indexOf('Información de seguridad');
  if (secIdx >= 0) {
    const sec = text.slice(secIdx);
    const nameM = sec.slice(sec.indexOf('\n')).match(/Name\s+(.+)/);
    out.security.name = nameM ? clean(nameM[1]) : null;
    const dsec = sec.match(/Description\s+([\s\S]*?)(?:\nHost name|\nName|$)/);
    out.security.description = dsec ? clean(dsec[1]) : null;
    const fp = sec.match(/located at\s+([^\n,]+?)\s*,/i) || sec.match(/File path\s+([^\n]+)/i);
    out.security.file_path = fp ? clean(fp[1]) : null;
    out.security.sha256 = (sec.match(/\b[a-f0-9]{64}\b/i) || [])[0] || null;
    const hn = sec.match(/Host name\s+([^\n]+)/);
    if (hn) {
      const h2 = clean(hn[1]);
      if (h2 && !out.hostnames.includes(h2)) out.hostnames.push(h2);
    }
  }

  out.attachments = (parsed.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size }));

  // Respuesta humana: primer segmento del thread (después delQUOTE del soar)
  if (out.is_reply) {
    const cut = text.search(/\n.*From:\s*\S+@\S+/);
    let seg = text.slice(0, cut > 0 ? cut : 300);
    // quitar banners de Proofpoint si vienen arriba
    seg = seg.replace(/ZjQcmQRYFpfptBanner[\s\S]*?ZjQcmQRYFpfptBannerEnd/, '');
    out.reply_action = clean(seg) || null;
  }

  return out;
}

if (require.main === module) {
  (async () => {
    const r = await parseEml(process.argv[2]);
    console.log(JSON.stringify(r, null, 2));
  })();
}

module.exports = { parseEml, parseEmlBuffer };
