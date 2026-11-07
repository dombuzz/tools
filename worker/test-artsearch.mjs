// Regressionstest «gleicher Artikel nur einmal»: node --no-warnings worker/test-artsearch.mjs (nutzt das eingebaute SQLite von Node 22+)
import { DatabaseSync } from 'node:sqlite';
import { saveArticle, ensureArt, searchArt, crawlStep, parseArticle } from './artsearch.js';
import assert from 'node:assert/strict';
const db = new DatabaseSync(':memory:');
const wrap = sql => { const mk = args => ({ bind: (...a) => mk(a), all: async () => { const st = db.prepare(sql); const r = /^\s*(select|pragma)/i.test(sql) ? st.all(...args) : (st.run(...args), []); return { results: r }; }, run: async () => { db.prepare(sql).run(...args); return {}; } , _sql: sql, _args: args}); return mk([]); };
const env = { DB: { prepare: wrap, batch: async sts => { db.exec('BEGIN'); try { for (const s of sts) db.prepare(s._sql).run(...s._args); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } } };
const art = (id, slug, title, d = '2026-11-06', section = 'novitads/grischun') => ({ id, url: 'https://www.rtr.ch/' + section.split('/')[0] + '/' + slug, title, kicker: '', descr: 'lead ' + title, section: '', path: '/' + section.split('/')[0] + '/' + slug, d, pub: d + 'T09:00:00.000Z', body: 'Text ' + title });
const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results;
await ensureArt(env);
const U1 = '01a1b09f-1b1b-2bd8-6431-9197365f97c3', U2 = 'a3c1b09f-1b1b-2bd8-6431-9197365f97c4';

// 1) Schmid: 6 Fassungen mit gleicher UUID, andere Adresse je Fassung → genau ein Eintrag mit neuestem Titel
for (const [i, t] of ['Martin Schmid tritt zurueck', 'Sez liber en Chombra pitschna', 'Sez liber 2', 'Dretg mument', 'Suenter 16 onns', 'Ina surpraisa'].entries())
  await saveArticle(env, art(U1, 'schmid-' + i, t));
await saveArticle(env, art(U2, 'anderer-artikel', 'Anderer Artikel'));
let r = await q("SELECT title, url FROM art ORDER BY id");
assert.equal(r.length, 2); assert.equal(r[0].title, 'Ina surpraisa'); assert.match(r[0].url, /schmid-5$/);
assert.equal((await q("SELECT count(*) n FROM art_fts"))[0].n, 2);
assert.equal((await searchArt(env, { q: 'schmid' })).items.length, 0 + (await searchArt(env, { q: 'surpraisa' })).items.length * 0); // Titel alt nicht mehr im Index
assert.equal((await searchArt(env, { q: 'Dretg' })).items.length, 0);
assert.equal((await searchArt(env, { q: 'surpraisa' })).items.length, 1);
console.log('1 ok: 6 Fassungen -> 1 Eintrag');

// 2) Il di: neue UUID je Fassung am selben Tag → ein Eintrag pro Tag, anderer Tag bleibt
await saveArticle(env, art('11111111-0000-0000-0000-000000000001', 'il-di/novitads-dals-06-11-2026-a', 'Novitads dals 06-11-2026', '2026-11-06', 'novitads/il-di'));
await saveArticle(env, art('11111111-0000-0000-0000-000000000002', 'il-di/novitads-dal-venderdi-arrest', 'Novitads dal venderdi', '2026-11-06', 'novitads/il-di'));
await saveArticle(env, art('11111111-0000-0000-0000-000000000003', 'il-di/novitads-dals-05-11-2026', 'Novitads dals 05-11', '2026-11-05', 'novitads/il-di'));
r = await q("SELECT title, d FROM art WHERE path LIKE '/novitads/il-di/%' ORDER BY d");
assert.deepEqual(r.map(x => x.title), ['Novitads dals 05-11', 'Novitads dal venderdi']);
console.log('2 ok: Il di 1x pro Tag');

// 3) Geöffnet-Stand wandert mit der Umbenennung
await db.exec("CREATE TABLE IF NOT EXISTS chatta_open (url TEXT PRIMARY KEY, first_at TEXT NOT NULL, last_at TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, h0 TEXT, chk_at TEXT, mod_at TEXT)");
await saveArticle(env, art('22222222-0000-0000-0000-000000000001', 'neu-a', 'Neu A'));
db.prepare("INSERT INTO chatta_open (url, first_at, last_at, n) VALUES ('https://www.rtr.ch/novitads/neu-a','2026-11-06T10:00:00Z','2026-11-06T10:00:00Z',2)").run();
await saveArticle(env, art('22222222-0000-0000-0000-000000000001', 'neu-b', 'Neu B'));
r = await q("SELECT url, n FROM chatta_open");
assert.deepEqual(r.map(x => [x.url, x.n]), [['https://www.rtr.ch/novitads/neu-b', 2]]);
console.log('3 ok: geoeffnet bleibt');

// 4) Bestandsbereinigung: Altlasten (6 Zeilen gleiche UUID + Il-di-Dubletten) direkt einfügen, dann crawlStep → dedup2
db.exec("DELETE FROM art; DELETE FROM art_fts; DELETE FROM chatta_open");
const ins = (aid, url, title, d, path) => { const x = db.prepare('INSERT INTO art (aid,url,title,kicker,descr,section,path,d,pub) VALUES (?,?,?,?,?,?,?,?,?)').run(aid, url, title, '', 'l', '', path, d, d + 'T09:00:00Z'); db.prepare('INSERT INTO art_fts (rowid,title,kicker,descr,body) VALUES (?,?,?,?,?)').run(x.lastInsertRowid, title, '', 'l', title); };
for (let i = 0; i < 6; i++) ins(U1, 'https://www.rtr.ch/novitads/s' + i, 'Version ' + i, '2026-11-06', '/novitads/s' + i);
ins('a0000000-0000-0000-0000-000000000001', 'https://www.rtr.ch/novitads/il-di/x1', 'Il di 1', '2026-11-06', '/novitads/il-di/x1');
ins('b0000000-0000-0000-0000-000000000002', 'https://www.rtr.ch/novitads/il-di/x2', 'Il di 2', '2026-11-06', '/novitads/il-di/x2');
ins('99999', 'https://www.rtr.ch/novitads/z1', 'Zahl alt', '2020-01-01', '/novitads/z1'); ins('99999', 'https://www.rtr.ch/novitads/z2', 'Zahl neu', '2020-01-01', '/novitads/z2');
ins('/novitads/p1', 'https://www.rtr.ch/novitads/p1', 'Pfad nur', '2020-01-02', '/novitads/p1');
db.prepare("INSERT INTO chatta_open (url, first_at, last_at, n) VALUES ('https://www.rtr.ch/novitads/s1','2026-11-06T10:00:00Z','2026-11-06T10:00:00Z',1)").run();
// Suche zeigt dank Sicherheitsnetz schon vor der Bereinigung keine Doppelten
const pre = await searchArt(env, { q: 'Version' }); assert.equal(pre.items.length, 1);
const preAll = await searchArt(env, {}); assert.equal(preAll.items.filter(x => /il-di/.test(x.url)).length, 1);
let fetches = 0; globalThis.fetch = async () => { fetches++; return { ok: false, status: 404, text: async () => '' }; }; // kein Netz im Test
await crawlStep(env).catch(() => {});
await (await import('./artsearch.js')).chattaRecheck(env);
r = await q("SELECT title FROM art ORDER BY id");
assert.deepEqual(r.map(x => x.title), ['Version 5', 'Il di 2', 'Zahl neu', 'Pfad nur']);
assert.equal((await q("SELECT count(*) n FROM art_fts"))[0].n, 4);
assert.equal((await q("SELECT url FROM chatta_open"))[0].url, 'https://www.rtr.ch/novitads/s5');
console.log('4 ok: Bestand bereinigt', r.map(x => x.title).join(' | '));

// 5) Status: zweiter Aufruf kommt aus dem Zwischenspeicher (keine erneute Zählung der ganzen Tabellen)
const { artStatus } = await import('./artsearch.js');
let reads = 0; const orig = db.prepare.bind(db); db.prepare = sql => { if (/FROM art_seen|FROM art\b(?! WHERE)/.test(sql) && /COUNT/.test(sql)) reads++; return orig(sql); };
const s1 = await artStatus(env), n1 = reads, s2 = await artStatus(env);
assert.equal(reads, n1); assert.equal(s1.articles, s2.articles);
console.log('5 ok: Status aus Zwischenspeicher');

// 6) Archiv ruht: Crawler holt nur aktuellen und Vormonat; ältere Monate werden weder eingelesen noch geholt
db.exec("DELETE FROM art_seen");
const now = new Date(), ym = d => d.getUTCFullYear() + '_' + String(d.getUTCMonth() + 1).padStart(2, '0');
const cur = ym(now), prev = ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
db.prepare("INSERT OR REPLACE INTO art_state (k, v) VALUES ('back', '2019_05'), ('cur_ts', ?)").run(String(Date.now()));
for (const [u, m] of [['old', '2019_05'], ['prevm', prev], ['curm', cur]]) db.prepare("INSERT INTO art_seen (url, ym) VALUES (?, ?)").run('https://www.rtr.ch/novitads/' + u, m);
const asked = []; globalThis.fetch = async u => { asked.push(String(u)); return { ok: false, status: 404, text: async () => '' }; };
for (let i = 0; i < 3; i++) await crawlStep(env).catch(() => {});
assert.ok(asked.some(u => u.endsWith('/curm')) && asked.some(u => u.endsWith('/prevm')), 'aktueller und Vormonat werden geholt');
assert.ok(!asked.some(u => /old|2019/.test(u)), 'Archiv wird nicht angefasst: ' + asked.join(','));
console.log('6 ok: nur aktueller + Vormonat, kein Archiv');
