// Eigener Suchindex für rtr.ch («Tschertga»): liest die monatlichen Artikel-Sitemaps, holt jeden Artikel einmal
// und legt Titel, Datum, Sparte, Lead und Text in D1 (Volltext-Index FTS5) ab. Unabhängig von der Suche auf rtr.ch.
// Gecrawlt wird höflich: wenige Abrufe pro Lauf (Cron), eigene Kennung im User-Agent, Pause bei hohem Tagesverbrauch.

const UA = 'Mozilla/5.0 (compatible; dombuzz-tools; +https://tools.dombuzz.ch/info)';
const SKIP = /\/(interpresa\/organisaziun|uffants\/lexicon)\//;
const PER_RUN = 25, MAX_TRIES = 3, WRITE_PAUSE = 70000, FIRST_YM = "2016_01";

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
  const path = new URL(url).pathname;
  return {
    id: meta(html, 'srf:content:id') || path,
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
    env.DB.prepare("CREATE VIRTUAL TABLE IF NOT EXISTS art_fts USING fts5(title, kicker, descr, body, tokenize = \"unicode61 remove_diacritics 2\")"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS art_seen (url TEXT PRIMARY KEY, ym TEXT, ok INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0)'),
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

export async function saveArticle(env, a) {
  const old = await env.DB.prepare('SELECT id FROM art WHERE url = ?1').bind(a.url).all();
  const st = [];
  if (old.results.length) {
    const id = old.results[0].id;
    st.push(env.DB.prepare('DELETE FROM art_fts WHERE rowid = ?1').bind(id));
    st.push(env.DB.prepare('UPDATE art SET aid=?2, title=?3, kicker=?4, descr=?5, section=?6, path=?7, d=?8, pub=?9 WHERE id = ?1').bind(id, a.id, a.title, a.kicker, a.descr, a.section, a.path, a.d, a.pub));
    st.push(env.DB.prepare('INSERT INTO art_fts (rowid, title, kicker, descr, body) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, a.title, a.kicker, a.descr, a.body));
  } else {
    st.push(env.DB.prepare('INSERT INTO art (aid, url, title, kicker, descr, section, path, d, pub) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)').bind(a.id, a.url, a.title, a.kicker, a.descr, a.section, a.path, a.d, a.pub));
    st.push(env.DB.prepare('INSERT INTO art_fts (rowid, title, kicker, descr, body) VALUES (last_insert_rowid(), ?1, ?2, ?3, ?4)').bind(a.title, a.kicker, a.descr, a.body));
  }
  await env.DB.batch(st);
}

// Ein Lauf: Sind Artikel vorgemerkt, werden bis zu PER_RUN davon geholt (neueste Monate zuerst).
// Sonst wird eine Sitemap eingelesen: der aktuelle Monat (höchstens alle 30 Min.), sonst der nächste ältere Monat bis 2016.
export async function crawlStep(env) {
  await ensureArt(env);
  const { results: [u] } = await env.DB.prepare("SELECT w FROM usage WHERE day = date('now')").all().catch(() => ({ results: [] }));
  if (u && u.w > WRITE_PAUSE) return { paused: true };
  const rows = (await env.DB.prepare('SELECT url FROM art_seen WHERE ok = 0 AND tries < ?1 ORDER BY ym DESC, rowid ASC LIMIT ?2').bind(MAX_TRIES, PER_RUN).all()).results;
  if (!rows.length) return sitemapStep(env);
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
async function sitemapStep(env) {
  const cur = ymOf(new Date()), lastCur = Number(await stGet(env, 'cur_ts') || 0);
  let ym = cur;
  if (Date.now() - lastCur < 30 * 60e3) {
    if (await stGet(env, 'complete')) return { idle: true };
    ym = (await stGet(env, 'back')) || prevYm(cur);
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
  const where = w.length ? ' AND ' + w.join(' AND ') : '';
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
  const one = async q => (await env.DB.prepare(q).all()).results[0];
  const n = (await one('SELECT COUNT(*) n, MIN(d) a, MAX(d) b FROM art')), s = await one('SELECT COUNT(*) n, SUM(ok = 0 AND tries < 3) open FROM art_seen');
  return { articles: n.n, oldest: n.a, newest: n.b, known: s.n, open: s.open || 0, back: await stGet(env, 'back'), complete: !!(await stGet(env, 'complete')) };
}
