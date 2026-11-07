// Eigener Suchindex für rtr.ch («Tschertga»): liest die monatlichen Artikel-Sitemaps, holt jeden Artikel einmal
// und legt Titel, Datum, Sparte, Lead und Text in D1 (Volltext-Index FTS5) ab. Unabhängig von der Suche auf rtr.ch.
// Gecrawlt wird höflich: wenige Abrufe pro Lauf (Cron), eigene Kennung im User-Agent, Pause bei hohem Tagesverbrauch.

const UA = 'Mozilla/5.0 (compatible; dombuzz-tools; +https://tools.dombuzz.ch/info)';
const SKIP = /\/(interpresa\/organisaziun|uffants\/lexicon)\//;
// SCHALTER: false = keine automatischen Abrufe von rtr.ch mehr (weder Crawler noch Nachprüfen geöffneter Artikel).
export const CRAWL_ON = true;
// Seit 07.11.2026 ist die Suche (Tschertga) aus: Der Crawler liest nur noch den aktuellen und den Vormonat (reicht für die Artitgel-challenge, die
// die letzten 30 Tage zeigt) und füllt das Archiv bis 2016 nicht mehr auf. Zum Wiederaufnehmen des Archivs auf true setzen (und SEARCH_ON in index.js).
export const ARCHIVE_ON = false;
export const SEARCH_ON = false;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stabile Artikel-ID: rtr.ch liefert eine UUID (früher eine Zahl). Fehlt beides, ist die ID nur der Pfad und taugt nicht zum Wiedererkennen.
export const stableId = id => UUID.test(id || '') || /^\d+$/.test(id || '');
const isIldi = path => /^\/novitads\/il-di\//.test(path || '');
const PER_RUN = 25, MAX_TRIES = 3, WRITE_PAUSE = 70000, FIRST_YM = "2016_01", CUR_EVERY = 9 * 60e3;

export const unesc = s => (s || '').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const strip = s => unesc(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, key) => {
  const re = new RegExp('<meta[^>]+(?:name|property|itemprop)=["\']' + key.replace(/[.:]/g, '\\$&') + '["\'][^>]*>', 'i');
  const tag = (html.match(re) || [''])[0], c = tag.match(/content=("([^"]*)"|'([^']*)')/i);
  return c ? unesc(c[2] ?? c[3]) : '';
};

// Datum in Schweizer Zeit (YYYY-MM-DD) aus «2016-05-02T09:01:00+02:00»: der lokale Tag steht schon im Text
export function parseArticle(html, url) {
  const pub = meta(html, 'datePublished');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(pub)) return null;
  const h1 = (html.match(/<h1[\s\S]*?<\/h1>/) || [''])[0];
  const kicker = strip((h1.match(/article-title__overline[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
  let title = strip((h1.match(/article-title__text[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
  if (!title) title = (meta(html, 'og:title') || '').replace(/^.*? - /, '');
  if (!title) return null;
  const lead = strip((html.match(/<p[^>]+class="article-lead"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
  const paras = [...html.matchAll(/<p[^>]+class="article-paragraph"[^>]*>([\s\S]*?)<\/p>/g)].map(m => strip(m[1])).filter(Boolean);
  // Adresse: kanonische URL der Seite (bei umbenannten Artikeln die aktuelle), sonst die abgerufene
  const canon = (html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [])[1] || meta(html, 'og:url');
  let path = new URL(url).pathname;
  try { const c = new URL(unesc(canon || ''), url); if (/^(www\.)?rtr\.ch$/i.test(c.hostname) && !/^\/article\//.test(c.pathname) && c.pathname.length > 1) path = c.pathname; } catch (e) {}
  return {
    id: meta(html, 'meta-srf:content:id') || meta(html, 'srf:content:id') || path,
    url: 'https://www.rtr.ch' + path,
    title, kicker,
    descr: meta(html, 'description') || lead,
    section: meta(html, 'article:section') || meta(html, 'articleSection') || '',
    path,
    d: pub.slice(0, 10),
    pub: new Date(pub).toISOString(),
    body: [lead, ...paras].join('\n').slice(0, 20000),
  };
}

export async function ensureArt(env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS art (id INTEGER PRIMARY KEY, aid TEXT, url TEXT UNIQUE NOT NULL, title TEXT, kicker TEXT, descr TEXT, section TEXT, path TEXT, d TEXT NOT NULL, pub TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS art_d ON art (d)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS art_aid ON art (aid)'),
    env.DB.prepare("CREATE VIRTUAL TABLE IF NOT EXISTS art_fts USING fts5(title, kicker, descr, body, tokenize = \"unicode61 remove_diacritics 2\")"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS art_seen (url TEXT PRIMARY KEY, ym TEXT, ok INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0)'),
    // Index, damit der Crawler nur die offenen Adressen liest und nicht bei jedem Lauf die ganze Tabelle (sonst Tausende gelesene Zeilen pro Lauf)
    env.DB.prepare('CREATE INDEX IF NOT EXISTS art_seen_open ON art_seen (ok, tries, ym)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS art_state (k TEXT PRIMARY KEY, v TEXT)'),
  ]);
}
const stGet = async (env, k) => { const { results: [r] } = await env.DB.prepare('SELECT v FROM art_state WHERE k = ?1').bind(k).all(); return r ? r.v : null; };
const stSet = (env, k, v) => env.DB.prepare('INSERT INTO art_state (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)).run();

const ymOf = d => d.getUTCFullYear() + '_' + String(d.getUTCMonth() + 1).padStart(2, '0');
const prevYm = ym => { const [y, m] = ym.split('_').map(Number); return ymOf(new Date(Date.UTC(y, m - 2, 1))); };

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml', 'Accept-Language': 'rm,de;q=0.8' } });
  return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
}

// Ein Artikel = eine Zeile. Derselbe Artikel (gleiche ID = srf:content:id, eine UUID) mit neuer Adresse, weil Titel oder Lead
// geändert wurden, ersetzt den alten Eintrag – er erscheint nie als neuer Artikel. «Il di» (jeden Tag mehrfach umbenannt): pro Tag nur ein Eintrag.
// Geöffnet-Stand (Artitgel-challenge) wird auf die neue Adresse übertragen.
export async function saveArticle(env, a) {
  const keyed = stableId(a.id), ildi = isIldi(a.path);
  const cond = ['url = ?1'], bind = [a.url];
  if (keyed) { cond.push('lower(aid) = ?' + (bind.push(a.id.toLowerCase()), bind.length)); }
  if (ildi) { cond.push("(d = ?" + (bind.push(a.d), bind.length) + " AND path LIKE '/novitads/il-di/%')"); }
  const found = (await env.DB.prepare('SELECT id, url FROM art WHERE ' + cond.join(' OR ') + ' ORDER BY id').bind(...bind).all()).results;
  const st = [];
  if (found.length) {
    const id = found[0].id;
    for (const r of found.slice(1)) { st.push(env.DB.prepare('DELETE FROM art_fts WHERE rowid = ?1').bind(r.id)); st.push(env.DB.prepare('DELETE FROM art WHERE id = ?1').bind(r.id)); }
    st.push(env.DB.prepare('DELETE FROM art_fts WHERE rowid = ?1').bind(id));
    st.push(env.DB.prepare('UPDATE art SET aid=?2, url=?10, title=?3, kicker=?4, descr=?5, section=?6, path=?7, d=?8, pub=?9 WHERE id = ?1').bind(id, a.id, a.title, a.kicker, a.descr, a.section, a.path, a.d, a.pub, a.url));
    st.push(env.DB.prepare('INSERT INTO art_fts (rowid, title, kicker, descr, body) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, a.title, a.kicker, a.descr, a.body));
    const old = found.map(r => r.url).filter(u => u !== a.url);
    if (old.length) st.push(...await moveOpened(env, old, a.url));
  } else {
    st.push(env.DB.prepare('INSERT INTO art (aid, url, title, kicker, descr, section, path, d, pub) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)').bind(a.id, a.url, a.title, a.kicker, a.descr, a.section, a.path, a.d, a.pub));
    st.push(env.DB.prepare('INSERT INTO art_fts (rowid, title, kicker, descr, body) VALUES (last_insert_rowid(), ?1, ?2, ?3, ?4)').bind(a.title, a.kicker, a.descr, a.body));
  }
  await env.DB.batch(st);
}
// «Geöffnet»-Daten (chatta_open, chatta_log) von alten Adressen auf die aktuelle übertragen, damit ein umbenannter Artikel nicht wieder «ungeöffnet» wird
async function moveOpened(env, oldUrls, url) {
  await ensureChatta(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS chatta_log (cid TEXT NOT NULL, url TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (cid, url))').run();
  const st = [];
  for (const o of oldUrls) {
    const { results: [x] } = await env.DB.prepare('SELECT url, first_at, last_at, n, h0, chk_at, mod_at FROM chatta_open WHERE url = ?1').bind(o).all();
    if (x) {
      const { results: [y] } = await env.DB.prepare('SELECT url FROM chatta_open WHERE url = ?1').bind(url).all();
      if (y) st.push(env.DB.prepare('UPDATE chatta_open SET first_at = MIN(first_at, ?2), last_at = MAX(last_at, ?3), n = n + ?4, mod_at = COALESCE(mod_at, ?5) WHERE url = ?1').bind(url, x.first_at, x.last_at, x.n, x.mod_at));
      else st.push(env.DB.prepare('UPDATE chatta_open SET url = ?2 WHERE url = ?1').bind(o, url));
      st.push(env.DB.prepare('DELETE FROM chatta_open WHERE url = ?1').bind(o));
    }
    st.push(env.DB.prepare('UPDATE OR IGNORE chatta_log SET url = ?2 WHERE url = ?1').bind(o, url));
    st.push(env.DB.prepare('DELETE FROM chatta_log WHERE url = ?1').bind(o));
  }
  return st;
}
// Einmalig (dedup2): bereits gespeicherte Doppelte entfernen – gleiche Artikel-ID (UUID oder Zahl), bei «Il di» pro Tag.
// Es bleibt die zuletzt gespeicherte Fassung (aktuellster Titel); geöffnet-Stand wird übertragen.
async function dedupeOnce(env) {
  if (await stGet(env, 'dedup2')) return;
  const groups = [
    "SELECT group_concat(id) ids FROM art WHERE (length(aid) = 36 AND aid GLOB '*-*-*-*-*') OR (aid <> '' AND aid NOT GLOB '*[^0-9]*') GROUP BY lower(aid) HAVING COUNT(*) > 1",
    "SELECT group_concat(id) ids FROM art WHERE path LIKE '/novitads/il-di/%' GROUP BY d HAVING COUNT(*) > 1",
  ];
  let removed = 0;
  for (const q of groups) {
    const { results } = await env.DB.prepare(q).all();
    for (const g of results) {
      const ids = g.ids.split(',').map(Number).sort((x, y) => x - y), keep = ids.pop();
      const { results: rows } = await env.DB.prepare('SELECT id, url FROM art WHERE id IN (' + [keep, ...ids].map(() => '?').join(',') + ')').bind(keep, ...ids).all();
      const keepUrl = rows.find(r => r.id === keep).url, st = [];
      st.push(...await moveOpened(env, rows.filter(r => r.id !== keep).map(r => r.url), keepUrl));
      for (const id of ids) { st.push(env.DB.prepare('DELETE FROM art_fts WHERE rowid = ?1').bind(id)); st.push(env.DB.prepare('DELETE FROM art WHERE id = ?1').bind(id)); }
      await env.DB.batch(st); removed += ids.length;
    }
  }
  await stSet(env, 'dedup2', String(removed));
}

// Ein Lauf: Sind Artikel vorgemerkt, werden bis zu PER_RUN davon geholt (neueste Monate zuerst).
// Der Crawler läuft alle 20 Min. (jeden zweiten 10-Min.-Cron). Die Sitemap des aktuellen Monats wird bei jedem Lauf neu gelesen (neue Artikel kommen so zuvorderst in die Warteschlange);
// ist die Warteschlange leer, wird der nächste ältere Monat bis 2016 eingelesen.
export async function crawlStep(env) {
  if (!CRAWL_ON) { await ensureArt(env); await dedupeOnce(env); return { paused: 'aus' }; } // nur die einmalige Bereinigung (rein in der Datenbank), kein Abruf
  let res;
  try { res = await crawlInner(env); } catch (e) { res = { error: String(e && e.message || e) }; }
  await stSet(env, 'last', JSON.stringify({ at: new Date().toISOString(), ...res })).catch(() => {});
  if (res.error) throw new Error(res.error);
  return res;
}
async function crawlInner(env) {
  await ensureArt(env);
  await dedupeOnce(env);
  const { results: [u] } = await env.DB.prepare("SELECT w FROM usage WHERE day = date('now')").all().catch(() => ({ results: [] }));
  if (u && u.w > WRITE_PAUSE) return { paused: true };
  // Aktueller Monat zuerst: dessen Sitemap alle CUR_EVERY neu lesen, auch wenn noch ältere Artikel in der Warteschlange sind
  let fresh = null;
  if (Date.now() - Number(await stGet(env, 'cur_ts') || 0) >= CUR_EVERY) fresh = await sitemapStep(env, true);
  const rows = (await env.DB.prepare('SELECT url FROM art_seen WHERE ok = 0 AND tries < ?1 AND ym >= ?3 ORDER BY ym DESC, rowid ASC LIMIT ?2').bind(MAX_TRIES, PER_RUN, ARCHIVE_ON ? '' : prevYm(ymOf(new Date()))).all()).results;
  if (!rows.length) return fresh || sitemapStep(env);
  let done = 0, failed = 0;
  for (const { url } of rows) {
    const r = await getText(url).catch(() => ({ ok: false, status: 0 }));
    if (r.ok) {
      const a = parseArticle(r.text, url);
      if (a) { await saveArticle(env, a); done++; }
      await env.DB.prepare('UPDATE art_seen SET ok = ?2 WHERE url = ?1').bind(url, a ? 1 : 2).run(); // 2 = keine Artikelseite
      continue;
    }
    failed++;
    const gone = r.status === 404 || r.status === 410;
    await env.DB.prepare('UPDATE art_seen SET tries = tries + ?2 WHERE url = ?1').bind(url, gone ? MAX_TRIES : 1).run();
    if (r.status === 429 || r.status >= 500) break; // rtr.ch schonen
  }
  return { done, failed };
}
async function sitemapStep(env, forceCur) {
  const cur = ymOf(new Date()), lastCur = Number(await stGet(env, 'cur_ts') || 0);
  let ym = cur;
  if (!forceCur && Date.now() - lastCur < CUR_EVERY) {
    if (await stGet(env, 'complete')) return { idle: true };
    ym = (await stGet(env, 'back')) || prevYm(cur);
    if (!ARCHIVE_ON && ym < prevYm(cur)) return { idle: true }; // Archiv ruht: nur aktueller und Vormonat
  }
  const sm = await getText('https://www.rtr.ch/sitemaps/aron/articles/' + ym + '.xml').catch(() => ({ ok: false, status: 0 }));
  if (sm.ok) {
    const urls = [...new Set([...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()))]
      .filter(x => /^https:\/\/www\.rtr\.ch\//.test(x) && !SKIP.test(x));
    for (let i = 0; i < urls.length; i += 50)
      await env.DB.batch(urls.slice(i, i + 50).map(x => env.DB.prepare('INSERT OR IGNORE INTO art_seen (url, ym) VALUES (?1, ?2)').bind(x, ym)));
    if (ym === cur) await stSet(env, 'cur_ts', Date.now());
    else if (ym <= FIRST_YM) await stSet(env, 'complete', new Date().toISOString());
    else await stSet(env, 'back', prevYm(ym));
    return { ym, queued: urls.length };
  }
  if (sm.status === 404 && ym !== cur) { // Monat ohne Sitemap: überspringen
    if (ym <= FIRST_YM) await stSet(env, 'complete', new Date().toISOString()); else await stSet(env, 'back', prevYm(ym));
  }
  if (ym === cur) await stSet(env, 'cur_ts', Date.now());
  return { ym, error: sm.status };
}

// Suche. Parameter: q, from/to (YYYY-MM-DD), section, sort = date_desc | date_asc | rel, page (ab 0), size
export async function searchArt(env, p) {
  await ensureArt(env);
  const size = Math.min(Math.max(+p.size || 20, 1), 50), off = Math.max(+p.page || 0, 0) * size;
  const tokens = ((p.q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  const fts = tokens.map(t => '"' + t + '"*').join(' ');
  const w = [], a = [];
  const isD = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (isD(p.from)) { w.push('art.d >= ?'); a.push(p.from); }
  if (isD(p.to)) { w.push('art.d <= ?'); a.push(p.to); }
  if (p.section) { w.push('art.section = ?'); a.push(String(p.section).slice(0, 80)); }
  // Sicherheitsnetz: nie mehrere Fassungen desselben Artikels zeigen (gleiche ID bzw. «Il di» pro Tag) – nur die neueste
  const dupFree = " AND NOT EXISTS (SELECT 1 FROM art b WHERE b.id > art.id AND ((art.aid <> '' AND b.aid = art.aid AND (length(art.aid) = 36 OR art.aid NOT GLOB '*[^0-9]*'))" +
    " OR (art.path LIKE '/novitads/il-di/%' AND b.d = art.d AND b.path LIKE '/novitads/il-di/%')))";
  const where = (w.length ? ' AND ' + w.join(' AND ') : '') + dupFree;
  const order = p.sort === 'date_asc' ? 'art.d ASC, art.pub ASC' : p.sort === 'rel' && fts ? 'bm25(art_fts, 8, 4, 3, 1)' : 'art.d DESC, art.pub DESC';
  const from = fts ? 'art_fts JOIN art ON art.id = art_fts.rowid WHERE art_fts MATCH ?' : 'art WHERE 1=1';
  const base = fts ? [fts] : [];
  const sel = 'art.url, art.title, art.kicker, art.section, art.d' + (fts ? ", snippet(art_fts, 3, char(2), char(3), ' … ', 24) AS snip, art.descr" : ', art.descr');
  const items = (await env.DB.prepare('SELECT ' + sel + ' FROM ' + from + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').bind(...base, ...a, size + 1, off).all()).results;
  const more = items.length > size; if (more) items.pop();
  // Jahre und Sparten für die Filter (ohne Datums-/Sparten-Einschränkung, nur mit Suchbegriff)
  let years = [], sections = [];
  if (!off) {
    const f2 = fts ? 'art_fts JOIN art ON art.id = art_fts.rowid WHERE art_fts MATCH ?' : 'art WHERE 1=1';
    years = (await env.DB.prepare("SELECT substr(art.d,1,4) y, COUNT(*) n FROM " + f2 + " GROUP BY y ORDER BY y DESC").bind(...base).all()).results;
    sections = (await env.DB.prepare("SELECT art.section s, COUNT(*) n FROM " + f2 + " AND art.section <> '' GROUP BY s ORDER BY n DESC LIMIT 20".replace('WHERE art_fts MATCH ? AND', 'WHERE art_fts MATCH ? AND')).bind(...base).all().catch(() => ({ results: [] }))).results;
  }
  return { items, more, years, sections };
}

export async function artStatus(env) {
  await ensureArt(env);
  const last = JSON.parse((await stGet(env, 'last')) || 'null');
  // Zähler sind nur Anzeige: höchstens alle 10 Min. neu zählen (das Zählen liest die ganzen Tabellen)
  const cached = JSON.parse((await stGet(env, 'status_cache')) || 'null');
  if (cached && Date.now() - cached.ts < 10 * 60e3) return { ...cached.v, back: await stGet(env, 'back'), last, complete: !!(await stGet(env, 'complete')) };
  const one = async q => (await env.DB.prepare(q).all()).results[0];
  const n = (await one('SELECT COUNT(*) n, MIN(d) a, MAX(d) b FROM art')), s = await one('SELECT COUNT(*) n, SUM(ok = 0 AND tries < 3) open FROM art_seen');
  const v = { articles: n.n, oldest: n.a, newest: n.b, known: s.n, open: s.open || 0 };
  await stSet(env, 'status_cache', JSON.stringify({ ts: Date.now(), v })).catch(() => {});
  return { ...v, back: await stGet(env, 'back'), last, complete: !!(await stGet(env, 'complete')) };
}

// Zähler fürs Dashboard: Anzahl Artikel unter rtr.ch/novitads, /sport, /cultura (nach URL-Pfad); «Il di» zählt 1× pro Tag
// für quest'emna (ab Montag), mais actual, ultims 30 dis (inkl. heute) und quest onn – Daten in Schweizer Zeit
export async function countArt(env) {
  await ensureArt(env);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date()); // YYYY-MM-DD
  const t = new Date(today + 'T00:00:00Z'), day = n => new Date(t.getTime() - n * 864e5).toISOString().slice(0, 10);
  const from = { week: day((t.getUTCDay() + 6) % 7), month: today.slice(0, 8) + '01', '30d': day(29), year: today.slice(0, 5) + '01-01' };
  const start = [from.year, from['30d']].sort()[0]; // Anfang Januar reichen die 30 Tage ins Vorjahr
  const { results } = await env.DB.prepare(
    "SELECT CASE WHEN path LIKE '/novitads/%' THEN 'novitads' WHEN path LIKE '/sport/%' THEN 'sport' ELSE 'cultura' END s," +
    " COUNT(DISTINCT CASE WHEN d >= ?1 THEN k END) week, COUNT(DISTINCT CASE WHEN d >= ?2 THEN k END) month," +
    " COUNT(DISTINCT CASE WHEN d >= ?3 THEN k END) d30, COUNT(DISTINCT CASE WHEN d >= ?4 THEN k END) year" +
    // «Il di» ist ein einziger Artikel pro Tag, der laufend neue URLs erhält: zählt als 1 pro Tag
    " FROM (SELECT path, d, CASE WHEN path LIKE '/novitads/il-di/%' THEN 'ildi:' || d ELSE url END k FROM art) WHERE d >= ?5 AND d <= ?6 AND (path LIKE '/novitads/%' OR path LIKE '/sport/%' OR path LIKE '/cultura/%') GROUP BY s"
  ).bind(from.week, from.month, from['30d'], from.year, start, today).all();
  const out = {};
  for (const s of ['novitads', 'sport', 'cultura']) {
    const r = results.find(x => x.s === s) || {};
    out[s] = { week: r.week || 0, month: r.month || 0, '30d': r.d30 || 0, year: r.year || 0 };
  }
  const { results: [nw] } = await env.DB.prepare('SELECT MAX(d) d FROM art').all();
  return { today, from, counts: out, newest: nw && nw.d };
}

// Artikel eines ganzen Kalendermonats (JJJJ-MM), «Il di» zählt 1 pro Tag – für die Monatsstatistik
export async function countArtMonth(env, key) {
  await ensureArt(env);
  const from = key + '-01', to = key + '-31';
  const { results } = await env.DB.prepare(
    "SELECT CASE WHEN path LIKE '/novitads/%' THEN 'novitads' WHEN path LIKE '/sport/%' THEN 'sport' ELSE 'cultura' END s, COUNT(DISTINCT k) n" +
    " FROM (SELECT path, d, CASE WHEN path LIKE '/novitads/il-di/%' THEN 'ildi:' || d ELSE url END k FROM art) WHERE d >= ?1 AND d <= ?2 AND (path LIKE '/novitads/%' OR path LIKE '/sport/%' OR path LIKE '/cultura/%') GROUP BY s"
  ).bind(from, to).all();
  const out = { novitads: 0, sport: 0, cultura: 0 };
  for (const r of results) out[r.s] = r.n;
  out.total = out.novitads + out.sport + out.cultura;
  return out;
}

// Wie viele der im Monat (JJJJ-MM) erschienenen Artikel wurden (bis jetzt) über die Challenge geöffnet?
export async function challengeMonth(env, key) {
  await ensureArt(env); await ensureChatta(env);
  const { results: [r] } = await env.DB.prepare(
    "SELECT COUNT(DISTINCT CASE WHEN a.path LIKE '/novitads/il-di/%' THEN 'ildi:' || a.d ELSE a.url END) n FROM chatta_open o JOIN art a ON a.url = o.url" +
    " WHERE a.d >= ?1 AND a.d <= ?2 AND (a.path LIKE '/novitads/%' OR a.path LIKE '/sport/%' OR a.path LIKE '/cultura/%')").bind(key + '-01', key + '-31').all();
  return { opened: r ? r.n : 0 };
}

// «Artitgel-challenge»: Übersicht aller Artikel der letzten 30 Tage unter /novitads, /cultura, /sport
// mit dem Zeitpunkt, an dem ein Artikel zuletzt über die Challenge geöffnet wurde (für alle gemeinsam).
// «Il di» erhält laufend neue URLs: pro Tag nur die neueste Fassung.
async function ensureChatta(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS chatta_open (url TEXT PRIMARY KEY, first_at TEXT NOT NULL, last_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1)').run();
  // Spalten für «actualisà suenter l'avertura»: Text-Fingerabdruck beim Öffnen (h0), zuletzt geprüft (chk_at), Änderung erkannt (mod_at)
  const { results: cols } = await env.DB.prepare('PRAGMA table_info(chatta_open)').all();
  const have = new Set(cols.map(c => c.name));
  for (const [c, t] of [['h0', 'TEXT'], ['chk_at', 'TEXT'], ['mod_at', 'TEXT']]) if (!have.has(c)) await env.DB.prepare(`ALTER TABLE chatta_open ADD COLUMN ${c} ${t}`).run().catch(() => {});
}
// Fingerabdruck des sichtbaren Artikeltexts (Titel, Lead, Absätze) – ändert sich, sobald jemand den Text korrigiert
async function textHash(url) {
  const r = await getText(url).catch(() => null);
  if (!r || !r.ok) return null;
  const a = parseArticle(r.text, url); if (!a) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode([a.kicker, a.title, a.body].join('\n')));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Geöffnete Artikel regelmässig nachprüfen (alle 20 Min., höchstens 8 Abrufe): stündlich in den ersten 3 Tagen, danach alle 12 Std., bis 30 Tage nach dem Öffnen.
// «Il di» nur, wenn er an einem späteren Tag geöffnet wurde (dann hat er eine Vergleichsbasis h0); am Publikationstag ändert er laufend.
export async function chattaRecheck(env) {
  if (!CRAWL_ON) return;
  await ensureChatta(env);
  const { results } = await env.DB.prepare(
    "SELECT url, h0, first_at FROM chatta_open WHERE mod_at IS NULL AND (url NOT LIKE '%/novitads/il-di/%' OR h0 IS NOT NULL) AND first_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')" +
    " AND (chk_at IS NULL OR chk_at < CASE WHEN first_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-55 minutes') ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 hours') END)" +
    " ORDER BY chk_at IS NOT NULL, chk_at LIMIT 8"
  ).all();
  for (const r of results) {
    const h = await textHash(r.url), now = new Date().toISOString();
    if (!h) { await env.DB.prepare('UPDATE chatta_open SET chk_at = ?2 WHERE url = ?1').bind(r.url, now).run(); continue; }
    if (!r.h0) await env.DB.prepare('UPDATE chatta_open SET h0 = ?2, chk_at = ?3 WHERE url = ?1').bind(r.url, h, now).run();
    else if (h !== r.h0) await env.DB.prepare('UPDATE chatta_open SET mod_at = ?2, chk_at = ?2 WHERE url = ?1').bind(r.url, now).run();
    else await env.DB.prepare('UPDATE chatta_open SET chk_at = ?2 WHERE url = ?1').bind(r.url, now).run();
  }
  return { checked: results.length };
}
export async function chattaOverview(env) {
  await ensureArt(env); await ensureChatta(env);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const from = new Date(Date.parse(today + 'T00:00:00Z') - 29 * 864e5).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT a.id, a.aid, a.url, a.title, a.kicker, a.d, a.pub, a.path, o.last_at opened, o.n, o.mod_at FROM art a LEFT JOIN chatta_open o ON o.url = a.url" +
    " WHERE a.d >= ?1 AND (a.path LIKE '/novitads/%' OR a.path LIKE '/cultura/%' OR a.path LIKE '/sport/%')" +
    // «Il di» des laufenden Tages wird noch ergänzt: erst ab dem Folgetag in der Challenge
    " AND (a.path NOT LIKE '/novitads/il-di/%' OR (a.d < ?2 AND a.id = (SELECT MAX(b.id) FROM art b WHERE b.d = a.d AND b.path LIKE '/novitads/il-di/%')))" +
    " ORDER BY a.pub DESC, a.id DESC"
  ).bind(from, today).all();
  // «Il di» erhält im Lauf des Tages neue URLs: «geöffnet» gilt für den ganzen Tag, egal welche Fassung geöffnet wurde
  const { results: ildi } = await env.DB.prepare(
    "SELECT a.d, MAX(o.last_at) opened, SUM(o.n) n, MAX(o.mod_at) mod_at FROM chatta_open o JOIN art a ON a.url = o.url WHERE a.d >= ?1 AND a.path LIKE '/novitads/il-di/%' GROUP BY a.d"
  ).bind(from).all();
  for (const r of results) if (r.path.startsWith('/novitads/il-di/')) { const x = ildi.find(y => y.d === r.d); if (x && (!r.opened || x.opened > r.opened)) { r.opened = x.opened; r.n = x.n; } if (x && x.mod_at) r.mod_at = x.mod_at; }
  // Artikel-ID (für den CMS-Link) fehlt bei älteren Einträgen: für geöffnete Artikel nachholen (höchstens 5 pro Aufruf)
  const miss = results.filter(r => r.opened && !UUID.test(r.aid || '')).slice(0, 5);
  await Promise.all(miss.map(async r => { const id = await fetchAid(r.url); if (id) { r.aid = id; await env.DB.prepare('UPDATE art SET aid = ?2 WHERE id = ?1').bind(r.id, id).run(); } }));
  const items = results.map(r => ({ url: r.url, title: r.title, kicker: r.kicker, d: r.d, pub: r.pub, rub: r.path.split('/')[1], ildi: r.path.startsWith('/novitads/il-di/'), aid: UUID.test(r.aid || '') ? r.aid.toLowerCase() : null, opened: r.opened || null, n: r.n || 0, mod: r.mod_at || null }));
  return { from, today, items };
}
async function fetchAid(url) {
  const r = await getText(url).catch(() => null);
  const m = r && r.ok && r.text.match(/urn:rtr:article:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}
export async function chattaOpen(env, u, cid) {
  await ensureArt(env); await ensureChatta(env);
  const { results: [a] } = await env.DB.prepare('SELECT url, d FROM art WHERE url = ?1').bind(String(u || '').slice(0, 500)).all();
  if (!a) return { ok: false, error: 'unknown' };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const now = new Date().toISOString();
  const { results: [o] } = await env.DB.prepare('SELECT h0 FROM chatta_open WHERE url = ?1').bind(a.url).all();
  await env.DB.prepare('INSERT INTO chatta_open (url, first_at, last_at, n) VALUES (?1, ?2, ?2, 1) ON CONFLICT(url) DO UPDATE SET last_at = ?2, n = n + 1').bind(a.url, now).run();
  // Textstand beim ersten Öffnen festhalten (Vergleichsbasis für «actualisà suenter l'avertura»)
  if (!o || !o.h0) { const h = /\/novitads\/il-di\//.test(a.url) && a.d >= today ? null : await textHash(a.url); if (h) await env.DB.prepare('UPDATE chatta_open SET h0 = ?2, chk_at = ?3 WHERE url = ?1 AND h0 IS NULL').bind(a.url, h, now).run(); }
  // pro Gerät festhalten (Rangliste in /game); im Modus test sendet der Browser nichts, frühere Öffnungen bleiben
  if (/^[A-Za-z0-9-]{8,40}$/.test(cid || '')) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS chatta_log (cid TEXT NOT NULL, url TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (cid, url))').run().then(() => env.DB.prepare('INSERT OR IGNORE INTO chatta_log (cid, url, ts) VALUES (?1, ?2, ?3)').bind(cid, a.url, now).run());
  }
  return { ok: true };
}
