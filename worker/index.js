// Cloudflare Worker für Likes und Nutzungen auf tools.dombuzz.ch
// Frage auf den Tool-Seiten: «Ha quest tool simplifitgà tia lavur?»
// Jeder Klick zählt (unlimitiert). Gespeichert wird nur: Tool-Name, Zeitpunkt, Anzahl.
//
// Voraussetzung: D1-Datenbank als Binding «DB» mit diesen Tabellen:
//   CREATE TABLE likes (tool TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, updated TEXT);
//   CREATE TABLE clicks (tool TEXT NOT NULL, ts TEXT NOT NULL);
//   CREATE INDEX clicks_ts ON clicks (ts);
//   CREATE TABLE uses (tool TEXT NOT NULL, ts TEXT NOT NULL);
//   CREATE INDEX uses_ts ON uses (ts);
//
// Schnittstelle:
//   GET  /likes                 -> {"Resizer2000": 14, ...}            (Total pro Tool)
//   POST /like/Resizer2000      -> {"tool": "Resizer2000", "count": 15}
//   POST /use/Resizer2000?c=<Zufalls-ID> -> {"ok": true}   (Tool hat ein Resultat geliefert: Download, Kopie …)
//   POST /view/Resizer2000?t=light|dark&c=<Zufalls-ID> -> {"ok": true}   (Seite wurde aufgerufen; Tabelle «views» legt der Worker selbst an; c = anonyme Kennung pro Browser)
//   (geschützt: /ranking, /hourly, /usage, /insights, /export nur mit Authorization: Bearer <FEEDBACK_PASSWORD>; öffentlich: GET /top?range=month|30d|all|week|today, inkl. views pro Tool)
//   GET  /ranking?range=all     -> Rangliste: all | today | week | 30d | month | lastmonth | YYYY-MM (Kalendermonat, UTC) (optional &scope=main|lab)
//                                  {range, from, to, total, items:[Likes], usesTotal, uses:[{tool, name, count, likes}]}
//                                  uses = Nutzungen pro Tool mit Anzeigename und Herzen (likes) im selben Zeitraum,
//                                  sortiert nach Nutzungen, dann Likes, dann Name (wie /stats)
//                                  daily=1 -> zusätzlich daily:[{day, tool, uses, likes, views}] (Rohdaten pro Tag)
//                                  favs = {tool: ☆ gesetzt im Zeitraum}, favsNow = {tool: aktuell markiert}, favsTotal
//                                  views = {tool: Seitenaufrufe}, viewsTotal = Summe, themes = {light, dark, unknown} Aufrufe nach Darstellung (nur für /stats),
//                                  clients = Anzahl verschiedener Besucher (Kennungen) im Zeitraum, gesamt über alle Tools (nur für /stats; erst ab Einführung der Kennung)
//                                  returning = davon an mindestens zwei verschiedenen Tagen (UTC) da; usingClients = Besucher mit mindestens einer Nutzung;
//                                  usesPerClient = Nutzungen pro nutzendem Besucher (Durchschnitt)

const ALLOWED_ORIGINS = ['https://tools.dombuzz.ch'];
const TOOL_NAME = /^[A-Za-z0-9_-]{1,40}$/;
// Anzeigenamen (für Widgets); unbekannte Tools erscheinen mit ihrer Kennung
const NAMES = { 'info': 'Infus & datas',
  'rtr-picture': 'RTR Picture-downloader', 'visual': 'Magazin / Il di / #mument', 'maletgs': 'Elavurar maletgs', 'Resizer2000': 'Resizer 2000',
  'Plan': 'Plans da teams', 'artitgel': "Links d'artitgels", 'artitgel-challenge': 'Artitgel-challenge', 'audio-recorder': 'Audio-Recorder', 'srt2ttml': 'SRT → TTML', 'studio': 'Subtitle Studio',
  'data': 'Memorisar grafica Datawrapper', 'votgr': 'Chartas votaziuns GR',
  'lab-csv': 'CSV-Analisa', 'lab-plan2geo': 'Plan → GeoJSON', 'lab-idioms': 'Pleds en ils idioms',
  'lab-profil': 'Höhenprofil', 'lab-hockey': 'Hockey regiunal',
};

// Mehrere Seiten unter einer Kennung zusammenzählen (Rohdaten bleiben pro Seite gespeichert)
// «Plans da teams»: neue Seite /Plan und die früheren Einzelseiten (Newsdesk, Radio, Televisiun, On demand, Squadra online)
// «Links d'artitgels»: die frühere Beta-Seite /artitgel-beta zählt zu /artitgel
// «Magazin / Il di / #mument»: das frühere Einzeltool /mument zählt zu /visual
// «Elavurar maletgs»: die Einzeltools im Hintergrund (/colurs, /rotar, /ebenas) und die frühere Adresse /layers zählen zu /maletgs
// «Subtitle Studio»: die früheren Einzeltools /spustar, /cumparegliar und /subs zählen zu /studio
const GROUP = { PlanOnline: 'Plan', PlanNewsdesk: 'Plan', PlanRadio: 'Plan', PlanTelevisiun: 'Plan', PlanOnDemand: 'Plan', 'artitgel-beta': 'artitgel', mument: 'visual', layers: 'maletgs', collage: 'maletgs', colurs: 'maletgs', rotar: 'maletgs', ebenas: 'maletgs', spustar: 'studio', cumparegliar: 'studio', subs: 'studio' };
const grp = t => GROUP[t] || t;
// Seiten, die nicht in der Statistik erscheinen (Statistikseite selbst)
const NO_STATS = new Set(['stats']);
const NO_STATS_SQL = `tool NOT IN (${[...NO_STATS].map(t => `'${t}'`).join(', ')})`;
// Modus test: Einträge eines Geräts (cid) bis zum Zeitpunkt, an dem es den Testmodus zuletzt gemeldet hat, nicht zählen (auch rückwirkend)
const EX = t => `NOT EXISTS (SELECT 1 FROM excl e WHERE e.cid = ${t}.cid AND ${t}.ts <= e.ts)`;
// Seiten, die keine Tools sind (in /statsB-Stundenzahlen ausgelassen)
const OTHER_PAGES = new Set(['index', 'game', 'top-popup', 'top', 'info', 'lab-index', '404']);
const merge = rows => Object.values(rows.filter(r => !NO_STATS.has(r.tool)).reduce((m, r) => {
  const k = grp(r.tool) + (r.day ? '|' + r.day : '');
  (m[k] ||= { ...r, tool: grp(r.tool), count: 0 }).count += r.count; return m;
}, {}));

// Tabelle für Seitenaufrufe bei Bedarf anlegen (einmal pro Worker-Start)
let viewsReady;
const ensureViews = env => viewsReady ||= env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS views (tool TEXT NOT NULL, ts TEXT NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS views_ts ON views (ts)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS favs (tool TEXT NOT NULL, ts TEXT NOT NULL, cid TEXT, added INTEGER NOT NULL)'), // ☆ gesetzt (1) / entfernt (0)
  env.DB.prepare('CREATE TABLE IF NOT EXISTS excl (cid TEXT PRIMARY KEY, ts TEXT NOT NULL)'), // Modus test: Geräte, deren Einträge bis ts nicht zählen
  // Indizes auf dem Zeitstempel: Abfragen für «oz», «quest'emna», «mais actual» lesen nur noch die Zeilen aus dem Zeitraum
  env.DB.prepare('CREATE INDEX IF NOT EXISTS uses_ts ON uses (ts)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS clicks_ts ON clicks (ts)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS favs_ts ON favs (ts)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, r INTEGER NOT NULL DEFAULT 0, w INTEGER NOT NULL DEFAULT 0)'), // gelesene/geschriebene Zeilen pro Tag (UTC)
  env.DB.prepare('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)'), // Zwischenspeicher für /ranking und /hourly
]).then(() => env.DB.prepare('ALTER TABLE views ADD COLUMN theme TEXT').run().catch(() => {})) // Spalte «theme» (light|dark) nachrüsten; Fehler = schon vorhanden
  .then(() => env.DB.prepare('ALTER TABLE views ADD COLUMN cid TEXT').run().catch(() => {})) // Spalte «cid» (anonyme Besucher-Kennung) nachrüsten
  .then(() => env.DB.prepare('ALTER TABLE uses ADD COLUMN cid TEXT').run().catch(() => {})) // auch bei den Nutzungen (für «Nutzungen pro Besucher»)
  .catch(e => { viewsReady = null; throw e; });

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}
function json(data, request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) },
  });
}
// Datum als 'YYYY-MM-DD HH:MM:SS' (UTC), wie SQLite datetime()
const sqlDate = d => d.toISOString().slice(0, 19).replace('T', ' ');

// Beginn des heutigen Tages bzw. der laufenden Woche (Montag) in Zürcher Zeit, als UTC-Zeitpunkt
function zurichStart(kind) {
  const now = new Date();
  const f = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(now).map(x => [x.type, +x.value]));
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second); // Zürcher Uhrzeit als UTC-Wert
  const off = Math.round((wall - now) / 6e4) * 6e4;
  const back = kind === 'week' ? (new Date(wall).getUTCDay() + 6) % 7 : 0;
  return new Date(Date.UTC(f.year, f.month - 1, f.day - back) - off);
}

function period(range) {
  const now = new Date();
  if (range === 'today' || range === 'week') return { from: sqlDate(zurichStart(range)), to: null };
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (range === '30d') return { from: sqlDate(new Date(now - 30 * 864e5)), to: null };
  if (range === 'month') return { from: sqlDate(new Date(Date.UTC(y, m, 1))), to: null };
  if (range === 'lastmonth') return { from: sqlDate(new Date(Date.UTC(y, m - 1, 1))), to: sqlDate(new Date(Date.UTC(y, m, 1))) };
  const mm = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(range);
  if (mm) { const yy = +mm[1], mo = +mm[2] - 1; return { from: sqlDate(new Date(Date.UTC(yy, mo, 1))), to: sqlDate(new Date(Date.UTC(yy, mo + 1, 1))) }; }
  return null; // all
}


// «Chatta Schweiz»: zufälliger rtr.ch-Artikel der letzten 30 Tage.
// Quelle: monatliche Artikel-Sitemaps von rtr.ch (nur Links, ohne Datum, in Publikationsreihenfolge).
// Die täglichen «Il di»-Artikel (…/novitads-dals-TT-MM-JJJJ-…) dienen als Datumsmarken.
async function rtrSitemap(ym) {
  const u = 'https://www.rtr.ch/sitemaps/aron/articles/' + ym + '.xml';
  const r = await fetch(u, { cf: { cacheTtl: 1800, cacheEverything: true } });
  if (!r.ok) return [];
  const xml = await r.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
  // Zuoberst stehen ältere, nachträglich bearbeitete Seiten (Rezepte, Porträts …): erst ab dem ersten «Il di» des Monats zählen
  const first = urls.findIndex(u => /novitads-dals-\d{2}-\d{2}-\d{4}/.test(u));
  return first > 0 ? urls.slice(first) : urls;
}
async function rtrRecent(days = 30) {
  const now = new Date();
  const ym = d => d.getUTCFullYear() + '_' + String(d.getUTCMonth() + 1).padStart(2, '0');
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const all = [...await rtrSitemap(ym(prev)), ...await rtrSitemap(ym(now))];
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days);
  let start = -1, seen = false;
  all.forEach((u, i) => {
    const m = u.match(/novitads-dals-(\d{2})-(\d{2})-(\d{4})/);
    if (!m) return;
    seen = true;
    if (Date.UTC(+m[3], +m[2] - 1, +m[1]) < cutoff) start = i;
  });
  const items = (seen ? all.slice(start + 1) : all)
    .filter(u => !/\/interpresa\/organisaziun\//.test(u));
  return [...new Set(items)];
}

// «Links d'artitgels» (beta): ID <-> URL cun text eines publizierten rtr.ch-Artikels.
// Die ID steht im Quelltext jedes Artikels (meta «meta-srf:urn» = urn:rtr:article:<ID>).
const ART_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function metaContent(html, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp('<meta[^>]+(?:name|property)=["\']' + k + '["\'][^>]*content=["\']([^"\']*)["\']', 'i'))
    || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:name|property)=["\']' + k + '["\']', 'i'));
  return m ? m[1] : '';
}
const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function rtrArticle(input) {
  let src;
  const idIn = ART_UUID.exec(input);
  if (idIn && !/^https?:\/\/(www\.)?rtr\.ch\/(?!article\/)/i.test(input)) src = 'https://www.rtr.ch/article/' + idIn[0].toLowerCase();
  else {
    let u; try { u = new URL(input); } catch (e) { return { error: 'url' }; }
    if (!/^(www\.)?rtr\.ch$/i.test(u.hostname)) return { error: 'host' };
    src = 'https://www.rtr.ch' + u.pathname;
  }
  const r = await fetch(src, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 dombuzz-tools',
      'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'rm,de;q=0.8',
    },
  });
  if (!r.ok) return { error: 'notfound', status: r.status };
  const html = await r.text();
  // ID: meta «meta-srf:urn» / «meta-srf:content:id», sonst irgendwo im Quelltext «urn:rtr:article:<ID>»
  const urn = metaContent(html, 'meta-srf:urn'), cid = metaContent(html, 'meta-srf:content:id');
  const any = html.match(/urn:rtr:article:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const idm = ART_UUID.exec(/article/i.test(urn) ? urn : cid) || (any && [any[1]]) || (idIn && [idIn[0]]);
  if (!idm) return { error: 'noid', status: r.status, len: html.length };
  const canon = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1] || metaContent(html, 'og:url');
  let url = canon ? unesc(canon) : r.url;
  if (/\/article\//.test(url)) url = /\/article\//.test(r.url) ? '' : r.url; // nur eine Adresse mit Text zurückgeben
  const portal = (metaContent(html, 'meta-srf:portal:urn').match(/portal:([A-Za-z0-9_-]+)/) || [])[1] || '';
  return { id: idm[0].toLowerCase(), url, title: unesc(metaContent(html, 'og:title') || ''), portal };
}


// ===== Cloudflare-Gratis-Kontingent im Blick behalten =====
// Jede D1-Abfrage meldet in meta, wie viele Zeilen sie gelesen/geschrieben hat. meterDB summiert das pro Anfrage,
// recordUsage schreibt die Summe in die Tabelle «usage» (ein Eintrag pro UTC-Tag; das Kontingent beginnt um 00:00 UTC neu).
const LIMIT_READ = 5e6, LIMIT_WRITE = 1e5;
const meterDB = (db, m) => {
  const add = res => { for (const x of [].concat(res)) { const mt = x && x.meta; if (mt) { m.r += mt.rows_read || 0; m.w += mt.rows_written || 0; } } return res; };
  const wrap = st => ({ _s: st, bind: (...a) => wrap(st.bind(...a)), all: () => st.all().then(add), run: () => st.run().then(add), first: c => st.first(c), raw: o => st.raw(o) });
  return { prepare: q => wrap(db.prepare(q)), batch: list => db.batch(list.map(x => x._s || x)).then(add), exec: q => db.exec(q), dump: () => db.dump() };
};
const recordUsage = (db, m) => db.prepare("INSERT INTO usage (day, r, w) VALUES (date('now'), ?1, ?2) ON CONFLICT(day) DO UPDATE SET r = r + ?1, w = w + ?2")
  .bind(m.r, m.w + 1).run().catch(() => {});
// Log-Kontingent (Workers Logs, ab 1.12.2026 im Gratis-Plan 0,5 GB pro Tag für das ganze Konto, Reset 00:00 UTC).
// Cloudflare liefert über die API nur die Anzahl Log-Einträge, nicht die Grösse: geschätzt mit Ø 5 kB pro Eintrag
// (Wert aus dem Dashboard «Observability → Usage»). Braucht die Secrets CF_ACCOUNT_ID und CF_API_TOKEN
// (Token mit Berechtigung «Workers Observability: Read»). Ohne Secrets bleibt «logs» leer. 10 Minuten zwischengespeichert.
const LOG_LIMIT_BYTES = 0.5e9, LOG_EVENT_BYTES = 5e3, LOG_CACHE_MS = 10 * 60 * 1000;
let logMem = null;
async function logsToday(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return { configured: false };
  const now = Date.now();
  if (logMem && now - logMem.ts < LOG_CACHE_MS) return logMem.v;
  const d = new Date(now), from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/observability/telemetry/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryId: 'dombuzz-log-usage', view: 'calculations', chartType: 'aggregate', ignoreSeries: true,
        timeframe: { from, to: now },
        parameters: { calculations: [{ operator: 'count' }], groupBys: [{ type: 'string', value: '$metadata.service' }], limit: 20 },
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) return { configured: true, error: r.status };
    const agg = (j.result?.calculations?.[0]?.aggregates) || [];
    const services = agg.map(a => ({ name: String(a.groups?.[0]?.value ?? '?'), events: Math.round(a.count ?? a.value ?? 0) }))
      .sort((a, b) => b.events - a.events);
    const events = services.reduce((t, x) => t + x.events, 0);
    const v = { configured: true, events, bytes: events * LOG_EVENT_BYTES, limitBytes: LOG_LIMIT_BYTES, estimated: true, services };
    logMem = { ts: now, v };
    return v;
  } catch (e) { return { configured: true, error: 'fetch' }; }
}
// Zwischenspeicher (2 Minuten) für die Statistik-Abfragen: zuerst im Speicher des Workers, sonst eine Zeile in der Tabelle «cache»
const CACHE_MS = 2 * 60 * 1000, mem = new Map();
async function cached(request, env, parts, url, compute) {
  const k = parts[0] + url.search;
  const now = Date.now(), hit = mem.get(k);
  if (hit && now - hit.ts < CACHE_MS) return new Response(hit.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) } });
  await ensureViews(env);
  const { results: [row] } = await env.DB.prepare('SELECT body, ts FROM cache WHERE k = ?1').bind(k).all();
  if (row && now - row.ts < CACHE_MS) { mem.set(k, row); return new Response(row.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(request) } }); }
  const res = await compute();
  if (res.status === 200) {
    const body = await res.clone().text(), e = { ts: now, body };
    mem.set(k, e); if (mem.size > 100) mem.delete(mem.keys().next().value);
    await env.DB.prepare('INSERT INTO cache (k, ts, body) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET ts = ?2, body = ?3').bind(k, now, body).run().catch(() => {});
  }
  return res;
}

// ---------- Feedback ----------
// Formular «Propostas, giavischs, critica?» unten in den Tools (like.js). Nicht in Statistiken.
// Lesen/Löschen nur mit Passwort: Secret FEEDBACK_PASSWORD (Cloudflare → Worker → Settings → Variables and Secrets).
// Hinweis bei neuem Feedback: Teams (Secret TEAMS_WEBHOOK_URL) und/oder Mail über Resend (Secret RESEND_API_KEY) – Cloudflare → Worker → Settings → Variables and Secrets.
let fbReady;
const ensureFeedback = env => fbReady ||= env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, tool TEXT NOT NULL, name TEXT, text TEXT NOT NULL, iph TEXT)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS feedback_ts ON feedback (ts)'),
]).then(() => env.DB.prepare("ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'nov'").run().catch(() => {})) // Status: nov | lavur | liquida | stizza
  .catch(e => { fbReady = null; throw e; });
const FB_STATUS = ['nov', 'lavur', 'liquida', 'stizza'];
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function fbAuth(request, env) {
  if (!env.FEEDBACK_PASSWORD) return 'unset';
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return given && await sha256(given) === await sha256(env.FEEDBACK_PASSWORD) ? 'ok' : 'no';
}
async function fbMail(env, tool, name, text) {
  const toolName = NAMES[tool] || tool, link = 'https://tools.dombuzz.ch/feedback';
  const jobs = [];
  // Microsoft Teams: Workflow «Bei Empfang einer Teams-Webhookanforderung» → Adaptive Card in Chat/Kanal; URL als Secret TEAMS_WEBHOOK_URL
  if (env.TEAMS_WEBHOOK_URL) jobs.push(fetch(env.TEAMS_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', text: 'Nov feedback: ' + toolName, weight: 'Bolder', size: 'Medium', wrap: true },
        { type: 'FactSet', facts: [{ title: 'Tool', value: toolName }, { title: 'Num', value: name || 'anonim' }] },
        { type: 'TextBlock', text: text, wrap: true },
      ],
      actions: [{ type: 'Action.OpenUrl', title: 'Avrir feedback', url: link }],
    } }] }),
  }).then(r => { if (!r.ok) throw new Error('teams ' + r.status); }));
  // Mail über Resend (optional): Secret RESEND_API_KEY, Empfänger FEEDBACK_TO (mehrere mit Komma), Absender FEEDBACK_FROM.
  // Eine Mail pro Empfänger: solange die Domain bei Resend nicht bestätigt ist, nimmt Resend nur die Konto-Adresse an –
  // so scheitert eine nicht erlaubte Adresse allein und blockiert die andere nicht.
  if (env.RESEND_API_KEY && env.FEEDBACK_TO) for (const to of env.FEEDBACK_TO.split(',').map(x => x.trim()).filter(Boolean)) jobs.push(fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FEEDBACK_FROM || 'dombuzz Tools <onboarding@resend.dev>', to: [to],
      subject: 'Feedback: ' + toolName,
      text: `Nov feedback sin tools.dombuzz.ch\n\nTool: ${toolName}\nNum: ${name || '(anonim)'}\n\n${text}\n\nLegger tut ils feedbacks: ${link}\n`,
    }),
  }).then(r => { if (!r.ok) throw new Error('resend ' + to + ' ' + r.status); }));
  await Promise.allSettled(jobs);
}

export default {
  async fetch(request, env, ctx) {
    const m = { r: 0, w: 0 }, raw = env.DB;
    env = { ...env, DB: meterDB(raw, m) };
    const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean);
    let res;
    try {
      // Statistik nur mit Passwort (Secret FEEDBACK_PASSWORD, wie /feedback); öffentlich bleibt nur /top (Rangliste ohne Besucherdaten)
      if (request.method === 'GET' && PROTECTED.has(parts[0]) && parts.length === 1) {
        const a = await fbAuth(request, env);
        if (a !== 'ok') return json({ error: a === 'unset' ? 'unset' : 'auth' }, request, a === 'unset' ? 503 : 401);
        if (parts[0] === 'export') { res = await exportData(request, env); if (m.r || m.w) ctx.waitUntil(recordUsage(raw, m)); return res; }
      }
      // Sicherung sofort in kDrive auslösen (Dashboard-Knopf)
      if (request.method === 'POST' && parts[0] === 'backup' && parts.length === 1) {
        const a = await fbAuth(request, env);
        if (a !== 'ok') return json({ error: 'auth' }, request, 401);
        res = json(await backupToKdrive(env), request); if (m.r || m.w) ctx.waitUntil(recordUsage(raw, m)); return res;
      }
      // Öffentliche Kurzfassung der Rangliste für die Startseite (Pop-up) und /top: nur Nutzungen und Herzen pro Tool
      if (request.method === 'GET' && parts[0] === 'top' && parts.length === 1) {
        const rq = url.searchParams.get('range') || 'month', range = ['month', '30d', 'all', 'week', 'today'].includes(rq) ? rq : 'month';
        const inner = new Request(url.origin + '/ranking?range=' + range, { headers: request.headers });
        const full = await cached(inner, env, ['ranking'], new URL(inner.url), () => handle(inner, env, ctx));
        if (!full.ok) return full;
        const d = await full.json();
        res = json({ range, usesTotal: d.usesTotal, viewsTotal: d.viewsTotal || 0, views: d.views || {}, total: d.total, items: d.items, uses: (d.uses || []).map(x => ({ tool: x.tool, name: x.name, count: x.count, likes: x.likes })) }, request);
        if (m.r || m.w) ctx.waitUntil(recordUsage(raw, m));
        return res;
      }
      // Verbrauch von heute (nicht zwischengespeichert, damit /stats immer den aktuellen Stand zeigt)
      if (request.method === 'GET' && parts[0] === 'usage' && parts.length === 1) {
        await ensureViews(env);
        const { results: [u] } = await env.DB.prepare("SELECT day, r, w FROM usage WHERE day = date('now')").all();
        res = json({ day: u?.day || new Date().toISOString().slice(0, 10), read: u?.r || 0, written: u?.w || 0, limitRead: LIMIT_READ, limitWritten: LIMIT_WRITE, logs: await logsToday(env) }, request);
      } else if (request.method === 'GET' && (parts[0] === 'ranking' || parts[0] === 'hourly' || parts[0] === 'insights') && parts.length === 1) {
        res = await cached(request, env, parts, url, () => handle(request, env, ctx));
      } else res = await handle(request, env, ctx);
    } catch (e) { ctx.waitUntil(reportError(env, url.pathname, e)); res = json({ error: 'server' }, request, 500); }
    if (m.r || m.w) ctx.waitUntil(recordUsage(raw, m));
    return res;
  },

  // Geplante Aufgaben (wrangler.jsonc → triggers.crons): stündliche Kontrolle und Monatsbericht am 1. des Monats
  async scheduled(event, env, ctx) {
    const m = { r: 0, w: 0 }, raw = env.DB;
    env = { ...env, DB: meterDB(raw, m) };
    try {
      if (event.cron === CRON_MONTHLY) await monthlyReport(env, ctx);
      else await hourlyChecks(env);
    } catch (e) { await reportError(env, 'cron ' + event.cron, e); }
    if (m.r || m.w) await recordUsage(raw, m);
  },
};

// ===== Schutz, Datensicherung, Warnungen, Monatsbericht =====
const PROTECTED = new Set(['ranking', 'hourly', 'usage', 'insights', 'export']);
const CRON_MONTHLY = '3 6 1 * *';
const DASH = 'https://tools.dombuzz.ch/dashboard';
const ensureMeta = env => env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, ts TEXT NOT NULL)').run();
async function metaGet(env, k) { await ensureMeta(env); const { results: [r] } = await env.DB.prepare('SELECT v, ts FROM meta WHERE k = ?1').bind(k).all(); return r || null; }
async function metaSet(env, k, v) { await ensureMeta(env); await env.DB.prepare("INSERT INTO meta (k, v, ts) VALUES (?1, ?2, datetime('now')) ON CONFLICT(k) DO UPDATE SET v = ?2, ts = datetime('now')").bind(k, v).run(); }
// einmal pro Schlüssel melden (z. B. pro Tag oder pro Commit)
async function once(env, k) { if (await metaGet(env, k)) return false; await metaSet(env, k, '1'); return true; }

// Adaptive Card an den Teams-Workflow (Secret TEAMS_WEBHOOK_URL)
async function teams(env, { title, text, facts = [], url = DASH, button = 'Avrir dashboard', warn = false }) {
  if (!env.TEAMS_WEBHOOK_URL) return false;
  const r = await fetch(env.TEAMS_WEBHOOK_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [
        { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true, color: warn ? 'Attention' : 'Default' },
        ...(facts.length ? [{ type: 'FactSet', facts: facts.map(([t, v]) => ({ title: t, value: String(v) })) }] : []),
        ...(text ? [{ type: 'TextBlock', text, wrap: true }] : []),
      ],
      actions: [{ type: 'Action.OpenUrl', title: button, url }],
    } }] }),
  }).catch(() => null);
  return !!(r && r.ok);
}

// Fehler im Worker: höchstens eine Meldung pro Stunde, mit Zahl der Fehler seither
async function reportError(env, where, e) {
  try {
    const now = Date.now(), r = await metaGet(env, 'err');
    let st = { last: 0, n: 0 }; try { if (r) st = JSON.parse(r.v); } catch (x) {}
    st.n++;
    if (now - st.last < 3600e3) { await metaSet(env, 'err', JSON.stringify(st)); return; }
    await teams(env, { title: '⚠ Errur en il worker', warn: true, facts: [['Nua', where], ['Errurs dapi l\'ultima annunzia', st.n]], text: String(e && e.message || e).slice(0, 400) });
    await metaSet(env, 'err', JSON.stringify({ last: now, n: 0 }));
  } catch (x) {}
}

async function hourlyChecks(env) {
  const day = new Date().toISOString().slice(0, 10), now = new Date();
  // 0 Wöchentliche Sicherung in kDrive: sonntags um 03 UTC (einmal pro Woche)
  if (env.KDRIVE_TOKEN && now.getUTCDay() === 0 && now.getUTCHours() === 3 && await once(env, 'backup:run:' + day)) {
    const b = await backupToKdrive(env);
    if (!b.ok) await teams(env, { title: '⚠ Backup en kDrive betg reussì', warn: true, text: String(b.error || '').slice(0, 300) });
  }
  // 1 Cloudflare-Kontingent (D1 und Logs) ab 80 %
  await ensureViews(env);
  const { results: [u] } = await env.DB.prepare("SELECT r, w FROM usage WHERE day = date('now')").all();
  const L = await logsToday(env);
  const p = { 'Lingias legidas': (u?.r || 0) / LIMIT_READ * 100, 'Lingias scrittas': (u?.w || 0) / LIMIT_WRITE * 100, 'Logs': L.bytes && L.limitBytes ? L.bytes / L.limitBytes * 100 : 0 };
  const hot = Object.entries(p).filter(([, v]) => v >= 80);
  if (hot.length && await once(env, 'alert:quota:' + day))
    await teams(env, { title: '⚠ Contingent Cloudflare quasi cuntanschì', warn: true, facts: hot.map(([k, v]) => [k, Math.round(v) + ' %']), text: 'Il contingent gratuit vegn renovà a las 00:00 UTC. Sche 100 % èn cuntanschids, na vegnan las datas betg pli memorisadas fin lura.' });
  // 2 Worker-Deploy hinter dem letzten Commit (worker/ oder wrangler.jsonc) – mehr als 30 Minuten
  const vm = env.CF_VERSION_METADATA, gh = p => fetch('https://api.github.com/repos/dombuzz/tools/' + p, { headers: { 'User-Agent': 'dombuzz-worker', Accept: 'application/vnd.github+json' } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (vm && vm.timestamp) {
    const [a, b] = await Promise.all([gh('commits?sha=main&path=worker&per_page=1'), gh('commits?sha=main&path=wrangler.jsonc&per_page=1')]);
    const last = [...(a || []), ...(b || [])].sort((x, y) => new Date(y.commit.committer.date) - new Date(x.commit.committer.date))[0];
    if (last) {
      const t = new Date(last.commit.committer.date), dep = new Date(vm.timestamp);
      if (t - dep > 60e3 && Date.now() - t > 30 * 60e3 && await once(env, 'alert:deploy:' + last.sha))
        await teams(env, { title: '⚠ Il worker n\'è betg vegnì actualisà', warn: true, facts: [['Ultim commit', last.commit.message.split('\n')[0]], ['Deploy actual', dep.toISOString().slice(0, 16).replace('T', ' ') + ' UTC']], text: 'Controllar Cloudflare → Workers → fragrant-grass-c193 → Deployments/Builds.', url: 'https://dash.cloudflare.com/', button: 'Avrir Cloudflare' });
    }
  }
  // 3a Datensicherung älter als 8 Tage (nur wenn kDrive eingerichtet ist)
  if (env.KDRIVE_TOKEN) {
    const bk = await metaGet(env, 'backup'), t = bk ? new Date(bk.ts.replace(' ', 'T') + 'Z') : null;
    if ((!t || Date.now() - t > 8 * 864e5) && await once(env, 'alert:backup:' + day) && (t || now.getUTCDay() === 1))
      await teams(env, { title: '⚠ Nagin backup actual', warn: true, facts: [['Ultim backup', t ? t.toISOString().slice(0, 10) : 'anc mai']], text: 'Il backup emnil en kDrive n\'è betg vegnì fatg. Controllar KDRIVE_TOKEN e la cartetta.' });
  }
  // 3 GitHub Pages: letzte Veröffentlichung fehlgeschlagen
  const deps = await gh('deployments?environment=github-pages&per_page=1');
  if (deps && deps[0]) {
    const st = await gh('deployments/' + deps[0].id + '/statuses?per_page=1');
    if (st && st[0] && (st[0].state === 'failure' || st[0].state === 'error') && await once(env, 'alert:pages:' + deps[0].id))
      await teams(env, { title: '⚠ Publitgaziun da las paginas fallida', warn: true, text: 'GitHub Pages n\'ha betg pudì publitgar l\'ultima versiun da tools.dombuzz.ch.', url: 'https://github.com/dombuzz/tools/actions', button: 'Avrir GitHub Actions' });
  }
}

// Monatsbericht am 1.: nur als Teams-Karte
const MONTHS_RM = ['schaner', 'favrer', 'mars', 'avrigl', 'matg', 'zercladur', 'fanadur', 'avust', 'settember', 'october', 'november', 'december'];
async function monthlyReport(env, ctx) {
  const now = new Date(), y = now.getUTCMonth() ? now.getUTCFullYear() : now.getUTCFullYear() - 1, mo = (now.getUTCMonth() + 11) % 12;
  const key = `${y}-${String(mo + 1).padStart(2, '0')}`, label = MONTHS_RM[mo] + ' ' + y;
  const res = await handle(new Request('https://worker/ranking?range=' + key), env, ctx);
  const d = res.ok ? await res.json() : null;
  let ok = false;
  if (d) {
    const main = (d.uses || []).filter(x => !x.tool.startsWith('lab-') && (x.count || x.likes)), lab = (d.uses || []).filter(x => x.tool.startsWith('lab-') && (x.count || x.likes));
    const line = x => `${x.name || x.tool}: ${x.count} duvrà · ♥ ${x.likes || 0} · ${d.views?.[x.tool] || 0} visitas`;
    const facts = [['Duvrà', d.usesTotal || 0], ['♥', d.total || 0], ['Visitas', d.viewsTotal || 0], ['Visitaders', d.clients || 0], ['Turnads (≥ 2 dis)', d.returning || 0]];
    const text = main.length ? main.map((x, i) => `${i + 1}. ${line(x)}`).join('\n\n') + (lab.length ? '\n\n**Lab:** ' + lab.map(line).join(' · ') : '') : 'Nagina utilisaziun quest mais.';
    const t = await teams(env, { title: 'Statistica tools.dombuzz.ch – ' + label, facts, text });
    ok = t;
    await metaSet(env, 'mail', JSON.stringify({ status: ok ? 'ok' : 'fail', month: key, teams: t }));
  } else await metaSet(env, 'mail', JSON.stringify({ status: 'fail', month: key }));
  return ok;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Datensicherung: /export (nur mit Passwort) – alle Tabellen als JSON zum Herunterladen ----
async function exportData(request, env) {
  const data = await collectData(env), rows = Object.values(data.tables).reduce((t, a) => t + a.length, 0);
  await metaSet(env, 'backup:download', JSON.stringify({ rows }));
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="dombuzz-backup-${data.created.slice(0, 10)}.json"`, 'Cache-Control': 'no-store', ...cors(request) } });
}
async function collectData(env) {
  const { results: tabs } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'cache' ORDER BY name").all();
  const data = { created: new Date().toISOString(), database: 'dombuzz-likes', tables: {} };
  for (const { name } of tabs) data.tables[name] = (await env.DB.prepare('SELECT * FROM "' + name.replace(/"/g, '') + '"').all()).results;
  return data;
}
// Sicherung in kDrive (Infomaniak-API): Secret KDRIVE_TOKEN (Scope «drive»), Variablen KDRIVE_DRIVE_ID und KDRIVE_DIR_ID (Ordner)
async function backupToKdrive(env) {
  if (!env.KDRIVE_TOKEN || !env.KDRIVE_DRIVE_ID || !env.KDRIVE_DIR_ID) return { ok: false, error: 'unset' };
  const data = await collectData(env), rows = Object.values(data.tables).reduce((t, a) => t + a.length, 0);
  const body = new TextEncoder().encode(JSON.stringify(data)), name = 'dombuzz-backup-' + data.created.slice(0, 10) + '.json';
  const q = new URLSearchParams({ directory_id: env.KDRIVE_DIR_ID, file_name: name, total_size: String(body.length), conflict: 'version' });
  const r = await fetch(`https://api.infomaniak.com/3/drive/${env.KDRIVE_DRIVE_ID}/upload?` + q, { method: 'POST', headers: { Authorization: 'Bearer ' + env.KDRIVE_TOKEN, 'Content-Type': 'application/octet-stream' }, body }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
  if (!r.ok) { const t = await r.text().catch(() => ''); return { ok: false, error: (r.status || '') + ' ' + t.slice(0, 200) }; }
  await metaSet(env, 'backup', JSON.stringify({ rows, bytes: body.length, file: name, where: 'kdrive' }));
  return { ok: true, rows, file: name };
}

async function handle(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    try {
      // Monats-Mail meldet sich nach dem Versand: /mailsent?s=ok|fail&m=YYYY-MM (aufgerufen vom geplanten Task)
      if (request.method === 'GET' && parts[0] === 'mailsent' && parts.length === 1) {
        const st = url.searchParams.get('s') === 'fail' ? 'fail' : 'ok', mo = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('m') || '') ? url.searchParams.get('m') : '';
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, ts TEXT NOT NULL)').run();
        await env.DB.prepare("INSERT INTO meta (k, v, ts) VALUES ('mail', ?1, datetime('now')) ON CONFLICT(k) DO UPDATE SET v = ?1, ts = datetime('now')").bind(JSON.stringify({ status: st, month: mo })).run();
        return json({ ok: true }, request);
      }

      // Dashboard-Box «Detagls»: Worker-Version und Monats-Mail
      if (request.method === 'GET' && parts[0] === 'insights' && parts.length === 1) {
        await ensureViews(env);
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT, ts TEXT NOT NULL)').run();
        const { results: [mr] } = await env.DB.prepare("SELECT v, ts FROM meta WHERE k = 'mail'").all();
        let mail = null; if (mr) { try { mail = { ...JSON.parse(mr.v), ts: mr.ts }; } catch (e) {} }
        const vm = env.CF_VERSION_METADATA || null, bk = await metaGet(env, 'backup');
        let backup = null; if (bk) { try { backup = { ...JSON.parse(bk.v), ts: bk.ts }; } catch (e) {} }
        return json({
          worker: vm ? { id: vm.id, tag: vm.tag || '', deployed: vm.timestamp } : null,
          mail, backup, teams: !!env.TEAMS_WEBHOOK_URL, kdrive: !!(env.KDRIVE_TOKEN && env.KDRIVE_DRIVE_ID && env.KDRIVE_DIR_ID),
        }, request);
      }

      // «Chatta Schweiz»: Liste (?list=1) oder direkt Weiterleitung auf einen Zufallsartikel
      if (request.method === 'GET' && parts[0] === 'chatta' && parts.length === 1) {
        const items = await rtrRecent(30);
        if (url.searchParams.get('list') === '1') return json({ count: items.length, items }, request);
        if (!items.length) return Response.redirect('https://www.rtr.ch/novitads', 302);
        const pick = items[Math.floor(Math.random() * items.length)];
        return new Response(null, { status: 302, headers: { Location: pick, 'Cache-Control': 'no-store' } });
      }

      // «Links d'artitgels» (beta): /artitgel?u=<ID, URN-Link oder URL cun text>
      if (request.method === 'GET' && parts[0] === 'artitgel' && parts.length === 1) {
        const u = (url.searchParams.get('u') || '').trim().slice(0, 500);
        if (!u) return json({ error: 'input' }, request, 400);
        const res = await rtrArticle(u);
        return json(res, request, res.error ? (res.error === 'notfound' || res.error === 'noid' ? 404 : 400) : 200);
      }

      // Total pro Tool
      if (request.method === 'GET' && parts[0] === 'likes' && parts.length === 1) {
        const { results } = await env.DB.prepare('SELECT tool, count FROM likes').all();
        return json(Object.fromEntries(merge(results).map(r => [r.tool, r.count])), request);
      }

      // Zahlen pro Stunde (UTC, 'YYYY-MM-DD HH') für /statsB: Wochenraster, Kurve der letzten 24 Stunden und Rekorde
      // GET /hourly?range=…  -> {range, uses:[{h, n}], views:[{h, n}]} (Tools ohne Lab; gleiche Filter wie /ranking)
      if (request.method === 'GET' && parts[0] === 'hourly' && parts.length === 1) {
        await ensureViews(env);
        const rq = url.searchParams.get('range') || '';
        const range = ['all', 'today', 'week', '30d', 'month', 'lastmonth', '24h'].includes(rq) || /^\d{4}-(0[1-9]|1[0-2])$/.test(rq) ? rq : 'all';
        const p = range === '24h' ? { from: sqlDate(new Date(Date.now() - 25 * 36e5)), to: null } : period(range);
        const out = { range };
        for (const tbl of ['uses', 'views']) {
          const { results } = await env.DB
            .prepare(`SELECT substr(ts, 1, 13) AS h, tool, COUNT(*) AS n FROM ${tbl} WHERE ts >= ?1 AND ts < ?2 AND ${NO_STATS_SQL} AND ${EX(tbl)} GROUP BY h, tool`)
            .bind(p?.from ?? '0', p?.to ?? '9999').all();
          const m = {};
          // nur Tools: Lab und «Autras paginas» (Startseite, /top, /game, 404) zählen hier nicht
          for (const r of results) { const t = grp(r.tool); if (t.startsWith('lab-') || OTHER_PAGES.has(t)) continue; m[r.h] = (m[r.h] || 0) + r.n; }
          out[tbl] = Object.entries(m).sort((a, b) => a[0].localeCompare(b[0])).map(([h, n]) => ({ h, n }));
        }
        return json(out, request);
      }

      // Rangliste für einen Zeitraum
      if (request.method === 'GET' && parts[0] === 'ranking' && parts.length === 1) {
        await ensureViews(env); // Tabelle «excl» muss vor den Abfragen bestehen
        const rq = url.searchParams.get('range') || '';
        const range = ['all', 'today', 'week', '30d', 'month', 'lastmonth'].includes(rq) || /^\d{4}-(0[1-9]|1[0-2])$/.test(rq) ? rq : 'all';
        const p = period(range);
        const { results: resultsRaw } = p
          ? await env.DB.prepare('SELECT tool, COUNT(*) AS count FROM clicks WHERE ts >= ?1 AND ts < ?2 GROUP BY tool ORDER BY count DESC')
              .bind(p.from, p.to ?? '9999').all()
          : await env.DB.prepare('SELECT tool, count FROM likes ORDER BY count DESC').all();
        const results = merge(resultsRaw).sort((a, b) => b.count - a.count);
        const total = results.reduce((t, r) => t + r.count, 0);
        const { results: usesRaw } = await env.DB
          .prepare('SELECT tool, COUNT(*) AS count FROM uses WHERE ' + EX('uses') + ' AND ts >= ?1 AND ts < ?2 GROUP BY tool ORDER BY count DESC')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const heart = Object.fromEntries(results.map(r => [r.tool, r.count]));
        const useMap = Object.fromEntries(merge(usesRaw).map(r => [r.tool, r.count]));
        // optional: scope=main (ohne Lab) oder scope=lab (nur Lab)
        const scope = url.searchParams.get('scope');
        const inScope = t => scope === 'main' ? !t.startsWith('lab-') : scope === 'lab' ? t.startsWith('lab-') : true;
        // wie auf der Statistikseite: Nutzungen, dann Likes (beide absteigend), dann Name
        const uses = [...new Set([...Object.keys(useMap), ...Object.keys(heart)])].filter(inScope)
          .map(t => ({ tool: t, name: NAMES[t] || t, count: useMap[t] || 0, likes: heart[t] || 0 }))
          .filter(r => r.count || r.likes)
          .sort((a, b) => b.count - a.count || b.likes - a.likes || a.name.localeCompare(b.name, 'de'));
        const usesTotal = uses.reduce((t, r) => t + r.count, 0);
        await ensureViews(env);
        const { results: viewRows } = await env.DB
          .prepare('SELECT tool, COUNT(*) AS count FROM views WHERE ' + NO_STATS_SQL + ' AND ' + EX('views') + ' AND ts >= ?1 AND ts < ?2 GROUP BY tool')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const views = Object.fromEntries(merge(viewRows).map(r => [r.tool, r.count]));
        const viewsTotal = merge(viewRows).reduce((t, r) => t + r.count, 0);
        const { results: themeRows } = await env.DB
          .prepare('SELECT theme, COUNT(*) AS count FROM views WHERE ' + NO_STATS_SQL + ' AND ' + EX('views') + ' AND ts >= ?1 AND ts < ?2 GROUP BY theme')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const themes = { light: 0, dark: 0, unknown: 0 };
        for (const r of themeRows) themes[r.theme === 'light' || r.theme === 'dark' ? r.theme : 'unknown'] += r.count;
        const { results: clientRows } = await env.DB
          .prepare('SELECT COUNT(DISTINCT cid) AS n FROM views WHERE ' + NO_STATS_SQL + ' AND ' + EX('views') + ' AND cid IS NOT NULL AND ts >= ?1 AND ts < ?2')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const clients = clientRows[0]?.n || 0;
        // wiederkehrend = Besucher, die im Zeitraum an mindestens zwei verschiedenen Tagen (UTC) da waren
        const { results: retRows } = await env.DB
          .prepare('SELECT COUNT(*) AS n FROM (SELECT cid FROM views WHERE ' + NO_STATS_SQL + ' AND ' + EX('views') + ' AND cid IS NOT NULL AND ts >= ?1 AND ts < ?2 GROUP BY cid HAVING COUNT(DISTINCT substr(ts, 1, 10)) > 1)')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const returning = retRows[0]?.n || 0;
        // nur für «quest'emna»: wie viele Besucher dieser Woche zum ersten Mal da waren (Dashboard-Kacheln)
        let newClients = null;
        if (range === 'week') {
          const { results: [nw] } = await env.DB.prepare('SELECT SUM(CASE WHEN first >= ?1 THEN 1 ELSE 0 END) AS n FROM (SELECT cid, MIN(ts) AS first, MAX(ts) AS last FROM views WHERE ' + NO_STATS_SQL + ' AND ' + EX('views') + ' AND cid IS NOT NULL GROUP BY cid) WHERE last >= ?1').bind(p.from).all();
          newClients = nw?.n || 0;
        }
        // Nutzungen pro Besucher: Durchschnitt unter den Besuchern, die mindestens eine Nutzung ausgelöst haben (nur Nutzungen mit Kennung)
        const { results: ucRows } = await env.DB
          .prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT cid) AS c FROM uses WHERE ' + NO_STATS_SQL + ' AND ' + EX('uses') + ' AND cid IS NOT NULL AND ts >= ?1 AND ts < ?2')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const usingClients = ucRows[0]?.c || 0;
        const usesPerClient = usingClients ? Math.round((ucRows[0].n / usingClients) * 10) / 10 : 0;
        // Favurits: wie oft ☆ im Zeitraum gesetzt wurde (favs) und wie viele aktuell markiert sind (favsNow = gesetzt − entfernt, gesamthaft)
        const { results: favRows } = await env.DB
          .prepare('SELECT tool, SUM(added) AS adds FROM favs WHERE ' + EX('favs') + ' AND ts >= ?1 AND ts < ?2 GROUP BY tool')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const { results: favNowRows } = await env.DB.prepare('SELECT tool, SUM(CASE WHEN added = 1 THEN 1 ELSE -1 END) AS n FROM favs WHERE ' + EX('favs') + ' GROUP BY tool').all();
        const favs = Object.fromEntries(favRows.filter(r => r.adds).map(r => [r.tool, r.adds]));
        // Geräte mit Favoriten: aktuell (mindestens ein ★ gesetzt) und im Zeitraum (mindestens ein ★ gesetzt)
        const { results: [fc] } = await env.DB.prepare('SELECT COUNT(DISTINCT cid) AS n FROM (SELECT cid, tool, SUM(CASE WHEN added = 1 THEN 1 ELSE -1 END) AS k FROM favs WHERE cid IS NOT NULL AND ' + EX('favs') + ' GROUP BY cid, tool HAVING k > 0)').all();
        const { results: [fp] } = await env.DB.prepare('SELECT COUNT(DISTINCT cid) AS n FROM favs WHERE cid IS NOT NULL AND added = 1 AND ' + EX('favs') + ' AND ts >= ?1 AND ts < ?2').bind(p?.from ?? '0', p?.to ?? '9999').all();
        const favsNow = Object.fromEntries(favNowRows.map(r => [r.tool, Math.max(0, r.n)]));
        const favsTotal = Object.values(favs).reduce((t, n) => t + n, 0);
        const out = { range, from: p?.from ?? null, to: p?.to ?? null, newClients, total, items: results, usesTotal, uses, views, viewsTotal, themes, clients, returning, usingClients, usesPerClient, favs, favsNow, favsTotal, favClients: fc?.n || 0, favClientsPeriod: fp?.n || 0 };
        // optional &daily=1: Rohdaten pro Tag und Tool (UTC) -> daily: [{day, tool, uses, likes, views}]
        if (url.searchParams.get('daily') === '1') {
          const from = p?.from ?? '0', to = p?.to ?? '9999';
          const day = {};
          for (const [tbl, key] of [['uses', 'uses'], ['clicks', 'likes'], ['views', 'views']]) {
            const { results: rr } = await env.DB
              .prepare(`SELECT substr(ts, 1, 10) AS day, tool, COUNT(*) AS count FROM ${tbl} WHERE ts >= ?1 AND ts < ?2${' AND ' + NO_STATS_SQL}${tbl === 'clicks' ? '' : ' AND ' + EX(tbl)} GROUP BY day, tool`)
              .bind(from, to).all();
            for (const r of merge(rr)) { const k = r.day + '|' + r.tool; (day[k] ||= { day: r.day, tool: r.tool, uses: 0, likes: 0, views: 0 })[key] = r.count; }
          }
          out.daily = Object.values(day).sort((a, b) => a.day.localeCompare(b.day) || a.tool.localeCompare(b.tool));
        }
        return json(out, request);
      }

      // Ein Like dazuzählen
      // POST /exclude?c=<cid>: Modus test meldet das Gerät; seine bisherigen Aufrufe, Nutzungen und Favoriten zählen nicht mehr
      if (request.method === 'POST' && parts[0] === 'exclude' && parts.length === 1) {
        const c = url.searchParams.get('c');
        if (!c || !/^[A-Za-z0-9-]{8,40}$/.test(c)) return json({ error: 'cid' }, request, 400);
        await ensureViews(env);
        await env.DB.prepare("INSERT INTO excl (cid, ts) VALUES (?1, datetime('now')) ON CONFLICT(cid) DO UPDATE SET ts = datetime('now')").bind(c).run();
        return json({ ok: true }, request);
      }

      if (request.method === 'POST' && parts[0] === 'like' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
        if (NO_STATS.has(tool)) return json({ ok: true }, request); // nicht erfassen
        const [, upd] = await env.DB.batch([
          env.DB.prepare("INSERT INTO clicks (tool, ts) VALUES (?1, datetime('now'))").bind(tool),
          env.DB.prepare(
            `INSERT INTO likes (tool, count, updated) VALUES (?1, 1, datetime('now'))
             ON CONFLICT(tool) DO UPDATE SET count = count + 1, updated = datetime('now')
             RETURNING count`).bind(tool),
        ]);
        return json({ tool, count: upd.results[0].count }, request);
      }

      // ☆ auf der Startseite gesetzt (?a=1) oder entfernt (?a=0)
      if (request.method === 'POST' && parts[0] === 'fav' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
        await ensureViews(env);
        const c = url.searchParams.get('c'), cid = c && /^[A-Za-z0-9-]{8,40}$/.test(c) ? c : null;
        await env.DB.prepare("INSERT INTO favs (tool, ts, cid, added) VALUES (?1, datetime('now'), ?2, ?3)").bind(tool, cid, url.searchParams.get('a') === '0' ? 0 : 1).run();
        return json({ ok: true }, request);
      }

      // Eine Nutzung zählen (like.js schickt das höchstens einmal pro Seitenaufruf)
      if (request.method === 'POST' && parts[0] === 'use' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
        if (NO_STATS.has(tool)) return json({ ok: true }, request); // nicht erfassen
        await ensureViews(env); // legt auch die Spalte uses.cid an
        const c = url.searchParams.get('c'), cid = c && /^[A-Za-z0-9-]{8,40}$/.test(c) ? c : null; // anonyme Besucher-Kennung
        await env.DB.prepare("INSERT INTO uses (tool, ts, cid) VALUES (?1, datetime('now'), ?2)").bind(tool, cid).run();
        return json({ ok: true }, request);
      }

      // Einen Seitenaufruf zählen (einmal pro Seitenaufruf, nur Tool-Name und Zeitpunkt)
      if (request.method === 'POST' && parts[0] === 'view' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
        if (NO_STATS.has(tool)) return json({ ok: true }, request); // Statistikseite und Tools im Hintergrund werden nicht gezählt
        await ensureViews(env);
        const t = url.searchParams.get('t'), theme = t === 'light' || t === 'dark' ? t : null; // angezeigte Darstellung
        const c = url.searchParams.get('c'), cid = c && /^[A-Za-z0-9-]{8,40}$/.test(c) ? c : null; // anonyme Besucher-Kennung
        await env.DB.prepare("INSERT INTO views (tool, ts, theme, cid) VALUES (?1, datetime('now'), ?2, ?3)").bind(tool, theme, cid).run();
        return json({ ok: true }, request);
      }

      // Feedback abgeben
      if (request.method === 'POST' && parts[0] === 'feedback' && parts.length === 1) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        let d; try { d = await request.json(); } catch (e) { return json({ error: 'json' }, request, 400); }
        const tool = String(d.tool || ''), text = String(d.text || '').trim(), name = String(d.name || '').trim().slice(0, 60);
        if (!TOOL_NAME.test(tool) || !text || text.length > 1000) return json({ error: 'input' }, request, 400);
        await ensureFeedback(env);
        // höchstens 5 Meldungen pro Tag und Anschluss (gespeichert wird nur ein Tages-Hash, keine IP)
        const iph = (await sha256((request.headers.get('CF-Connecting-IP') || '') + '|' + new Date().toISOString().slice(0, 10))).slice(0, 16);
        const { results: rc } = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE iph = ?1 AND ts >= datetime('now', '-1 day')").bind(iph).all();
        if ((rc[0]?.n || 0) >= 5) return json({ error: 'limit' }, request, 429);
        await env.DB.prepare("INSERT INTO feedback (ts, tool, name, text, iph) VALUES (datetime('now'), ?1, ?2, ?3, ?4)").bind(tool, name || null, text, iph).run();
        if (ctx && ctx.waitUntil) ctx.waitUntil(fbMail(env, tool, name, text).catch(() => {}));
        return json({ ok: true }, request);
      }
      // Feedback lesen (Passwort)
      if (request.method === 'GET' && parts[0] === 'feedback' && parts.length === 1) {
        const a = await fbAuth(request, env);
        if (a !== 'ok') return json({ error: a === 'unset' ? 'unset' : 'auth' }, request, a === 'unset' ? 503 : 401);
        await ensureFeedback(env);
        const { results } = await env.DB.prepare('SELECT id, ts, tool, name, text, status FROM feedback ORDER BY id DESC LIMIT 1000').all();
        return json({ items: results.map(r => ({ ...r, toolName: NAMES[r.tool] || r.tool })) }, request);
      }
      // Status ändern (Passwort): nov, lavur (En lavur), liquida (Liquidà), stizza (Stizzà, im Papierkorb)
      if (request.method === 'POST' && parts[0] === 'feedback' && parts.length === 3 && parts[2] === 'status') {
        const a = await fbAuth(request, env);
        if (a !== 'ok') return json({ error: a === 'unset' ? 'unset' : 'auth' }, request, a === 'unset' ? 503 : 401);
        let d; try { d = await request.json(); } catch (e) { return json({ error: 'json' }, request, 400); }
        if (!FB_STATUS.includes(d.status)) return json({ error: 'status' }, request, 400);
        await ensureFeedback(env);
        await env.DB.prepare('UPDATE feedback SET status = ?1 WHERE id = ?2').bind(d.status, +parts[1] || 0).run();
        return json({ ok: true }, request);
      }
      // Feedback endgültig löschen (Passwort; die Seite bietet das nur im Papierkorb an)
      if (request.method === 'DELETE' && parts[0] === 'feedback' && parts.length === 2) {
        const a = await fbAuth(request, env);
        if (a !== 'ok') return json({ error: a === 'unset' ? 'unset' : 'auth' }, request, a === 'unset' ? 503 : 401);
        await ensureFeedback(env);
        await env.DB.prepare('DELETE FROM feedback WHERE id = ?1').bind(+parts[1] || 0).run();
        return json({ ok: true }, request);
      }

      return json({ error: 'not found' }, request, 404);
    } catch (e) {
      if (ctx) ctx.waitUntil(reportError(env, url.pathname, e));
      return json({ error: 'server' }, request, 500);
    }
}
