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
//   GET  /ranking?range=all     -> Rangliste: all | today | week | 30d | month | lastmonth | YYYY-MM (Kalendermonat, UTC) (optional &scope=main|lab)
//                                  {range, from, to, total, items:[Likes], usesTotal, uses:[{tool, name, count, likes}]}
//                                  uses = Nutzungen pro Tool mit Anzeigename und Herzen (likes) im selben Zeitraum,
//                                  sortiert nach Nutzungen, dann Likes, dann Name (wie /stats)
//                                  daily=1 -> zusätzlich daily:[{day, tool, uses, likes, views}] (Rohdaten pro Tag)
//                                  views = {tool: Seitenaufrufe}, viewsTotal = Summe, themes = {light, dark, unknown} Aufrufe nach Darstellung (nur für /stats),
//                                  clients = Anzahl verschiedener Besucher (Kennungen) im Zeitraum, gesamt über alle Tools (nur für /stats; erst ab Einführung der Kennung)
//                                  returning = davon an mindestens zwei verschiedenen Tagen (UTC) da; usingClients = Besucher mit mindestens einer Nutzung;
//                                  usesPerClient = Nutzungen pro nutzendem Besucher (Durchschnitt)

const ALLOWED_ORIGINS = ['https://tools.dombuzz.ch'];
const TOOL_NAME = /^[A-Za-z0-9_-]{1,40}$/;
// Anzeigenamen (für Widgets); unbekannte Tools erscheinen mit ihrer Kennung
const NAMES = {
  'rtr-picture': 'RTR Picture-downloader', 'visual': 'Magazin / Il di', 'Resizer2000': 'Resizer 2000',
  'Plan': 'Plans da teams', 'artitgel': "Links d'artitgel", 'audio-recorder': 'Audio-Recorder', 'srt2ttml': 'SRT → TTML',
  'subs': 'Suttitels RM → DE', 'data': 'Memorisar grafica Datawrapper', 'votgr': 'Chartas votaziuns GR',
  'lab-csv': 'CSV-Analisa', 'lab-plan2geo': 'Plan → GeoJSON', 'lab-idioms': 'Pleds en ils idioms',
  'lab-profil': 'Höhenprofil', 'lab-hockey': 'Hockey regiunal',
};

// Mehrere Seiten unter einer Kennung zusammenzählen (Rohdaten bleiben pro Seite gespeichert)
// «Plans da teams»: neue Seite /Plan und die früheren Einzelseiten (Newsdesk, Radio, Televisiun, On demand, Squadra online)
const GROUP = { PlanOnline: 'Plan', PlanNewsdesk: 'Plan', PlanRadio: 'Plan', PlanTelevisiun: 'Plan', PlanOnDemand: 'Plan' };
const grp = t => GROUP[t] || t;
const merge = rows => Object.values(rows.reduce((m, r) => {
  const k = grp(r.tool) + (r.day ? '|' + r.day : '');
  (m[k] ||= { ...r, tool: grp(r.tool), count: 0 }).count += r.count; return m;
}, {}));

// Tabelle für Seitenaufrufe bei Bedarf anlegen (einmal pro Worker-Start)
let viewsReady;
const ensureViews = env => viewsReady ||= env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS views (tool TEXT NOT NULL, ts TEXT NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS views_ts ON views (ts)'),
]).then(() => env.DB.prepare('ALTER TABLE views ADD COLUMN theme TEXT').run().catch(() => {})) // Spalte «theme» (light|dark) nachrüsten; Fehler = schon vorhanden
  .then(() => env.DB.prepare('ALTER TABLE views ADD COLUMN cid TEXT').run().catch(() => {})) // Spalte «cid» (anonyme Besucher-Kennung) nachrüsten
  .then(() => env.DB.prepare('ALTER TABLE uses ADD COLUMN cid TEXT').run().catch(() => {})) // auch bei den Nutzungen (für «Nutzungen pro Besucher»)
  .catch(e => { viewsReady = null; throw e; });

function cors(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    try {
      // Total pro Tool
      if (request.method === 'GET' && parts[0] === 'likes' && parts.length === 1) {
        const { results } = await env.DB.prepare('SELECT tool, count FROM likes').all();
        return json(Object.fromEntries(results.map(r => [r.tool, r.count])), request);
      }

      // Rangliste für einen Zeitraum
      if (request.method === 'GET' && parts[0] === 'ranking' && parts.length === 1) {
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
          .prepare('SELECT tool, COUNT(*) AS count FROM uses WHERE ts >= ?1 AND ts < ?2 GROUP BY tool ORDER BY count DESC')
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
          .prepare('SELECT tool, COUNT(*) AS count FROM views WHERE ts >= ?1 AND ts < ?2 GROUP BY tool')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const views = Object.fromEntries(merge(viewRows).map(r => [r.tool, r.count]));
        const viewsTotal = viewRows.reduce((t, r) => t + r.count, 0);
        const { results: themeRows } = await env.DB
          .prepare('SELECT theme, COUNT(*) AS count FROM views WHERE ts >= ?1 AND ts < ?2 GROUP BY theme')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const themes = { light: 0, dark: 0, unknown: 0 };
        for (const r of themeRows) themes[r.theme === 'light' || r.theme === 'dark' ? r.theme : 'unknown'] += r.count;
        const { results: clientRows } = await env.DB
          .prepare('SELECT COUNT(DISTINCT cid) AS n FROM views WHERE cid IS NOT NULL AND ts >= ?1 AND ts < ?2')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const clients = clientRows[0]?.n || 0;
        // wiederkehrend = Besucher, die im Zeitraum an mindestens zwei verschiedenen Tagen (UTC) da waren
        const { results: retRows } = await env.DB
          .prepare('SELECT COUNT(*) AS n FROM (SELECT cid FROM views WHERE cid IS NOT NULL AND ts >= ?1 AND ts < ?2 GROUP BY cid HAVING COUNT(DISTINCT substr(ts, 1, 10)) > 1)')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const returning = retRows[0]?.n || 0;
        // Nutzungen pro Besucher: Durchschnitt unter den Besuchern, die mindestens eine Nutzung ausgelöst haben (nur Nutzungen mit Kennung)
        const { results: ucRows } = await env.DB
          .prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT cid) AS c FROM uses WHERE cid IS NOT NULL AND ts >= ?1 AND ts < ?2')
          .bind(p?.from ?? '0', p?.to ?? '9999').all();
        const usingClients = ucRows[0]?.c || 0;
        const usesPerClient = usingClients ? Math.round((ucRows[0].n / usingClients) * 10) / 10 : 0;
        const out = { range, from: p?.from ?? null, to: p?.to ?? null, total, items: results, usesTotal, uses, views, viewsTotal, themes, clients, returning, usingClients, usesPerClient };
        // optional &daily=1: Rohdaten pro Tag und Tool (UTC) -> daily: [{day, tool, uses, likes, views}]
        if (url.searchParams.get('daily') === '1') {
          const from = p?.from ?? '0', to = p?.to ?? '9999';
          const day = {};
          for (const [tbl, key] of [['uses', 'uses'], ['clicks', 'likes'], ['views', 'views']]) {
            const { results: rr } = await env.DB
              .prepare(`SELECT substr(ts, 1, 10) AS day, tool, COUNT(*) AS count FROM ${tbl} WHERE ts >= ?1 AND ts < ?2 GROUP BY day, tool`)
              .bind(from, to).all();
            for (const r of merge(rr)) { const k = r.day + '|' + r.tool; (day[k] ||= { day: r.day, tool: r.tool, uses: 0, likes: 0, views: 0 })[key] = r.count; }
          }
          out.daily = Object.values(day).sort((a, b) => a.day.localeCompare(b.day) || a.tool.localeCompare(b.tool));
        }
        return json(out, request);
      }

      // Ein Like dazuzählen
      if (request.method === 'POST' && parts[0] === 'like' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
        const [, upd] = await env.DB.batch([
          env.DB.prepare("INSERT INTO clicks (tool, ts) VALUES (?1, datetime('now'))").bind(tool),
          env.DB.prepare(
            `INSERT INTO likes (tool, count, updated) VALUES (?1, 1, datetime('now'))
             ON CONFLICT(tool) DO UPDATE SET count = count + 1, updated = datetime('now')
             RETURNING count`).bind(tool),
        ]);
        return json({ tool, count: upd.results[0].count }, request);
      }

      // Eine Nutzung zählen (like.js schickt das höchstens einmal pro Seitenaufruf)
      if (request.method === 'POST' && parts[0] === 'use' && parts.length === 2) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, request, 403);
        const tool = decodeURIComponent(parts[1]);
        if (!TOOL_NAME.test(tool)) return json({ error: 'tool' }, request, 400);
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
        await ensureViews(env);
        const t = url.searchParams.get('t'), theme = t === 'light' || t === 'dark' ? t : null; // angezeigte Darstellung
        const c = url.searchParams.get('c'), cid = c && /^[A-Za-z0-9-]{8,40}$/.test(c) ? c : null; // anonyme Besucher-Kennung
        await env.DB.prepare("INSERT INTO views (tool, ts, theme, cid) VALUES (?1, datetime('now'), ?2, ?3)").bind(tool, theme, cid).run();
        return json({ ok: true }, request);
      }

      return json({ error: 'not found' }, request, 404);
    } catch (e) {
      return json({ error: 'server' }, request, 500);
    }
  },
};
