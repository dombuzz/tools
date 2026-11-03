// Profile und Ranking für /game.
// Profil: Anzeigename + Wiederherstellungscode (kein Passwort, keine Mailadresse). Der Code wird nur einmal angezeigt, gespeichert wird ein Hash.
// Ein Profil hängt an einer oder mehreren anonymen Gerätekennungen (cid); die bisherige Nutzung dieser Geräte zählt rückwirkend mit.
// Punkte werden hier aus den Nutzungsdaten des Workers berechnet (nicht vom Browser gemeldet):
//   gday = Tagesverdichtung (Gerät × Zürcher Tag × Tool) aus den Tabellen views/uses; abgeschlossene UTC-Tage werden einmal verdichtet
//   (Cron alle 10 Min.), der laufende Tag wird bei Bedarf direkt gelesen. So bleiben die gelesenen Zeilen klein (Gratis-Kontingent).

export const GAME_TOOLS = ['rtr-picture', 'visual', 'maletgs', 'Resizer2000', 'Plan', 'artitgel', 'artitgel-challenge', 'audio-recorder', 'srt2ttml', 'studio', 'data', 'votgr']; // = Tools im Dropdown der Startseite; bei neuen Tools ergänzen
export const POINTS = { day: 5, act: 1, actCap: 20, tool: 10, art: 3, artCap: 3, badge: 20, streak: [[3, 15], [7, 40], [30, 150]] };

const CID = /^[A-Za-z0-9-]{8,40}$/;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O/1/I
const TZ = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' });
const zday = d => TZ.format(d); // YYYY-MM-DD in Zürcher Zeit
const utcDate = ts => new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z'));
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const num = d => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
const isWeekend = n => { const w = new Date(n * 864e5).getUTCDay(); return w === 0 || w === 6; };
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const newCode = () => { const s = [...crypto.getRandomValues(new Uint8Array(8))].map(x => ALPHA[x % 32]).join(''); return s.slice(0, 4) + '-' + s.slice(4); };
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cleanName = n => { n = String(n || '').normalize('NFC').replace(/\s+/g, ' ').trim(); return /^[\p{L}\p{N}][\p{L}\p{N} .'_-]{1,23}$/u.test(n) ? n : null; };
const nkey = n => String(n || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
const err = (error, status = 400) => ({ status, data: { error } });

let ready;
const ensure = env => ready ||= env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS gprofile (id TEXT PRIMARY KEY, name TEXT NOT NULL, nkey TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, code_hash TEXT NOT NULL, created TEXT NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS gdevice (cid TEXT PRIMARY KEY, pid TEXT NOT NULL, ts TEXT NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS gdevice_pid ON gdevice (pid)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS gfail (k TEXT NOT NULL, ts INTEGER NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS gday (cid TEXT NOT NULL, day TEXT NOT NULL, tool TEXT NOT NULL, uday TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 0, u INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cid, day, tool, uday))'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS gday_uday ON gday (uday)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS gstate (k TEXT PRIMARY KEY, v TEXT)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS chatta_log (cid TEXT NOT NULL, url TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (cid, url))'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, ts INTEGER NOT NULL, body TEXT NOT NULL)'),
]).catch(e => { ready = null; throw e; });

const stGet = async (env, k) => { const { results: [r] } = await env.DB.prepare('SELECT v FROM gstate WHERE k = ?1').bind(k).all(); return r ? r.v : null; };
const stSet = (env, k, v) => env.DB.prepare('INSERT INTO gstate (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2').bind(k, String(v)).run();
const dropCache = env => env.DB.prepare("DELETE FROM cache WHERE k LIKE 'game:%'").run().catch(() => {});

const toolNames = GROUP => [...GAME_TOOLS, ...Object.keys(GROUP).filter(k => GAME_TOOLS.includes(GROUP[k]))];

// Zeilen aus views/uses im UTC-Zeitraum [from, to) zu (Gerät × Zürcher Tag × Tool) zusammenzählen
async function aggRange(env, GROUP, from, to) {
  const grp = t => GROUP[t] || t;
  const ex = new Map((await env.DB.prepare('SELECT cid, ts FROM excl').all().catch(() => ({ results: [] }))).results.map(r => [r.cid, r.ts])); // Modus test
  const m = new Map();
  for (const [tbl, key] of [['views', 'v'], ['uses', 'u']]) {
    const { results } = await env.DB.prepare(`SELECT cid, tool, ts FROM ${tbl} WHERE ts >= ?1 AND ts < ?2 AND cid IS NOT NULL`).bind(from, to).all();
    for (const r of results) {
      const t = grp(r.tool); if (!GAME_TOOLS.includes(t)) continue;
      const e = ex.get(r.cid); if (e && r.ts <= e) continue;
      const day = zday(utcDate(r.ts)), k = r.cid + '|' + day + '|' + t;
      let o = m.get(k); if (!o) m.set(k, o = { cid: r.cid, day, tool: t, v: 0, u: 0 });
      o[key]++;
    }
  }
  return m;
}

// Abgeschlossene UTC-Tage verdichten (höchstens maxDays pro Lauf). Gibt den letzten verdichteten Tag zurück.
export async function gameAggregate(env, GROUP, maxDays = 10) {
  await ensure(env);
  const today = new Date().toISOString().slice(0, 10);
  let wm = await stGet(env, 'wm');
  if (!wm) {
    const { results: [a] } = await env.DB.prepare('SELECT MIN(ts) t FROM views').all();
    const { results: [b] } = await env.DB.prepare('SELECT MIN(ts) t FROM uses').all();
    const first = [a && a.t, b && b.t].filter(Boolean).sort()[0];
    if (!first) return { wm: null, done: 0 };
    wm = addDay(first.slice(0, 10), -1);
  }
  let done = 0;
  for (let d = addDay(wm, 1); d < today && done < maxDays; d = addDay(d, 1), done++) {
    const rows = [...(await aggRange(env, GROUP, d + ' 00:00:00', addDay(d, 1) + ' 00:00:00')).values()];
    await env.DB.prepare('DELETE FROM gday WHERE uday = ?1').bind(d).run(); // erneuter Lauf ersetzt den Tag (kein Doppelzählen)
    for (let i = 0; i < rows.length; i += 50)
      await env.DB.batch(rows.slice(i, i + 50).map(r => env.DB.prepare('INSERT INTO gday (cid, day, tool, uday, v, u) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(cid, day, tool, uday) DO UPDATE SET v = ?5, u = ?6').bind(r.cid, r.day, r.tool, d, r.v, r.u)));
    wm = d; await stSet(env, 'wm', wm);
  }
  return { wm, done };
}

const profileOf = async (env, cid) => {
  if (!CID.test(cid || '')) return null;
  const { results: [p] } = await env.DB.prepare('SELECT p.id, p.name FROM gdevice d JOIN gprofile p ON p.id = d.pid WHERE d.cid = ?1').bind(cid).all();
  return p || null;
};

// ---- Profile ----
export async function gameRegister(env, b) {
  await ensure(env);
  const cid = String(b.c || ''), name = cleanName(b.name);
  if (!CID.test(cid)) return err('cid');
  if (!name) return err('name');
  if (await profileOf(env, cid)) return err('already');
  const { results: [cnt] } = await env.DB.prepare('SELECT COUNT(*) n FROM gprofile').all();
  if (cnt.n >= 500) return err('full', 429);
  const id = rnd(8), salt = rnd(8), code = newCode(), now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO gprofile (id, name, nkey, salt, code_hash, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, name, nkey(name), salt, await sha(salt + normCode(code)), now),
      env.DB.prepare('INSERT INTO gdevice (cid, pid, ts) VALUES (?1, ?2, ?3)').bind(cid, id, now),
    ]);
  } catch (e) { if (/UNIQUE/i.test(String(e && e.message || e))) return err('taken', 409); throw e; }
  await dropCache(env);
  return { status: 200, data: { ok: true, name, code } };
}

export async function gameLogin(env, b) {
  await ensure(env);
  const cid = String(b.c || ''), key = nkey(b.name);
  if (!CID.test(cid) || !key) return err('login');
  const since = Date.now() - 15 * 60e3;
  const { results: [f] } = await env.DB.prepare('SELECT COUNT(*) n FROM gfail WHERE ts > ?1 AND (k = ?2 OR k = ?3)').bind(since, 'n:' + key, 'c:' + cid).all();
  if (f.n >= 6) return err('limit', 429);
  const { results: [p] } = await env.DB.prepare('SELECT id, name, salt, code_hash FROM gprofile WHERE nkey = ?1').bind(key).all();
  if (!p || (await sha(p.salt + normCode(b.code))) !== p.code_hash) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO gfail (k, ts) VALUES (?1, ?3), (?2, ?3)').bind('n:' + key, 'c:' + cid, Date.now()),
      env.DB.prepare('DELETE FROM gfail WHERE ts < ?1').bind(Date.now() - 864e5),
    ]);
    return err('login', 401);
  }
  await env.DB.prepare('INSERT INTO gdevice (cid, pid, ts) VALUES (?1, ?2, ?3) ON CONFLICT(cid) DO UPDATE SET pid = ?2, ts = ?3').bind(cid, p.id, new Date().toISOString()).run();
  await dropCache(env);
  return { status: 200, data: { ok: true, name: p.name } };
}

export async function gameLogout(env, b) {
  await ensure(env);
  if (CID.test(String(b.c || ''))) await env.DB.prepare('DELETE FROM gdevice WHERE cid = ?1').bind(String(b.c)).run();
  await dropCache(env);
  return { status: 200, data: { ok: true } };
}

export async function gameNewCode(env, b) {
  await ensure(env);
  const p = await profileOf(env, String(b.c || ''));
  if (!p) return err('noprofile', 403);
  const salt = rnd(8), code = newCode();
  await env.DB.prepare('UPDATE gprofile SET salt = ?2, code_hash = ?3 WHERE id = ?1').bind(p.id, salt, await sha(salt + normCode(code))).run();
  return { status: 200, data: { ok: true, code } };
}

export async function gameDelete(env, b) {
  await ensure(env);
  const p = await profileOf(env, String(b.c || ''));
  if (!p) return err('noprofile', 403);
  await env.DB.batch([env.DB.prepare('DELETE FROM gdevice WHERE pid = ?1').bind(p.id), env.DB.prepare('DELETE FROM gprofile WHERE id = ?1').bind(p.id)]);
  await dropCache(env);
  return { status: 200, data: { ok: true } };
}

export async function gameMe(env, cid) {
  await ensure(env);
  const p = await profileOf(env, cid);
  return { status: 200, data: { profile: p ? { name: p.name } : null } };
}

// ---- Ranking ----
const runsOf = days => { // days: aufsteigend sortierte Tage; Samstag/Sonntag ohne Nutzung unterbrechen die Serie nicht
  const runs = []; let cur = [];
  for (const d of days) {
    if (!cur.length) { cur = [d]; continue; }
    let ok = true;
    for (let x = num(cur[cur.length - 1]) + 1, b = num(d); x < b; x++) if (!isWeekend(x)) { ok = false; break; }
    if (ok) cur.push(d); else { runs.push(cur); cur = [d]; }
  }
  if (cur.length) runs.push(cur);
  return runs;
};

// Tage, an denen ein Badge erreicht wurde (alle Zeit) – wie die Badges in /game
function badgeDays(rec) {
  const days = [...rec.days.keys()].sort(), firsts = [...rec.first.values()].sort(), out = [];
  const half = Math.ceil(GAME_TOOLS.length / 2);
  if (firsts.length >= 1) out.push(firsts[0]);                                 // Emprim tool
  if (firsts.length >= half) out.push(firsts[half - 1]);                        // Mez scuvrì
  if (firsts.length >= GAME_TOOLS.length) out.push(firsts[GAME_TOOLS.length - 1]); // Tut scuvrì
  const r3 = runsOf(days).filter(r => r.length >= 3).map(r => r[2]).sort()[0]; if (r3) out.push(r3); // 3 dis a la lunga
  if (days.length >= 7) out.push(days[6]);                                      // 7 dis differents
  if (days.length >= 30) out.push(days[29]);                                    // 30 dis differents
  let cum = 0; const goals = [10, 100, 500];
  for (const d of days) { cum += rec.days.get(d).u; while (goals.length && cum >= goals[0]) { out.push(d); goals.shift(); } } // 10/100/500 acziuns
  return out;
}

function scoreFor(rec, inP, bdays) {
  const days = [...rec.days.keys()].filter(inP).sort();
  const acts = days.reduce((a, d) => a + Math.min(rec.days.get(d).u, POINTS.actCap), 0);
  const coll = [...rec.first.values()].filter(inP).length;
  const seria = runsOf(days).reduce((m, r) => Math.max(m, r.length), 0);
  const art = [...rec.art.entries()].filter(([d]) => inP(d)).reduce((a, [, n]) => a + Math.min(n, POINTS.artCap), 0);
  const bdg = bdays.filter(inP).length;
  const bonus = POINTS.streak.reduce((a, [need, pts]) => a + (seria >= need ? pts : 0), 0);
  const pts = days.length * POINTS.day + acts * POINTS.act + coll * POINTS.tool + bonus + art * POINTS.art + bdg * POINTS.badge;
  return { pts, seria, coll, acts, art, bdg, days: days.length };
}

async function computeAll(env, GROUP) {
  const wmRun = await gameAggregate(env, GROUP, 10);
  const { results: prof } = await env.DB.prepare('SELECT p.id, p.name, d.cid FROM gprofile p LEFT JOIN gdevice d ON d.pid = p.id').all();
  const per = new Map(), byCid = new Map();
  for (const r of prof) {
    if (!per.has(r.id)) per.set(r.id, { id: r.id, name: r.name, days: new Map(), first: new Map(), art: new Map() });
    if (r.cid) byCid.set(r.cid, r.id);
  }
  const add = (cid, day, tool, u) => {
    const rec = per.get(byCid.get(cid)); if (!rec) return;
    const o = rec.days.get(day) || { u: 0 }; o.u += u; rec.days.set(day, o);
    const f = rec.first.get(tool); if (!f || day < f) rec.first.set(tool, day);
  };
  if (byCid.size) {
    const { results } = await env.DB.prepare('SELECT cid, day, tool, SUM(v) v, SUM(u) u FROM gday WHERE cid IN (SELECT cid FROM gdevice) GROUP BY cid, day, tool').all();
    for (const r of results) add(r.cid, r.day, r.tool, r.u);
    // noch nicht verdichtete Tage (laufender UTC-Tag) direkt lesen
    const wm = wmRun.wm; if (wm) for (const o of (await aggRange(env, GROUP, addDay(wm, 1) + ' 00:00:00', '9999-12-31 00:00:00')).values()) if (byCid.has(o.cid)) add(o.cid, o.day, o.tool, o.u);
    // Artikel der Artitgel-challenge: pro Person und Artikel das erste Öffnen, pro Tag zählen höchstens 3
    const { results: ar } = await env.DB.prepare('SELECT cid, url, ts FROM chatta_log WHERE cid IN (SELECT cid FROM gdevice)').all();
    const first = new Map();
    for (const r of ar) { const k = byCid.get(r.cid) + '|' + r.url; if (!first.has(k) || r.ts < first.get(k)) first.set(k, r.ts); }
    for (const [k, ts] of first) { const rec = per.get(k.split('|')[0]); if (!rec) continue; const d = zday(new Date(ts)); rec.art.set(d, (rec.art.get(d) || 0) + 1); }
  }
  const now = zday(new Date()), P = { month: now.slice(0, 7), year: now.slice(0, 4), all: 'all' };
  const out = { total: GAME_TOOLS.length, updated: new Date().toISOString(), p: { month: [], year: [], all: [] } };
  for (const rec of per.values()) {
    const bd = badgeDays(rec);
    for (const [name, pre] of Object.entries(P)) out.p[name].push({ id: rec.id, name: rec.name, ...scoreFor(rec, d => pre === 'all' || d.startsWith(pre), bd) });
  }
  return out;
}

export async function gameRanking(env, GROUP, cid, period) {
  await ensure(env);
  const me = await profileOf(env, cid);
  if (!me) return err('noprofile', 403);
  const now = zday(new Date()), key = 'game:' + now.slice(0, 7);
  let body; const { results: [c] } = await env.DB.prepare('SELECT ts, body FROM cache WHERE k = ?1').bind(key).all();
  if (c && Date.now() - c.ts < 5 * 60e3) body = JSON.parse(c.body);
  else {
    body = await computeAll(env, GROUP);
    await env.DB.prepare('INSERT INTO cache (k, ts, body) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET ts = ?2, body = ?3').bind(key, Date.now(), JSON.stringify(body)).run();
  }
  const p = ['month', 'year', 'all'].includes(period) ? period : 'month';
  return { status: 200, data: { period: p, total: body.total, updated: body.updated, rows: body.p[p].map(({ id, ...r }) => ({ ...r, me: id === me.id })) } };
}

// Router: gibt { status, data } zurück oder null, wenn die Adresse nicht zu /game gehört
export async function gameRoute(request, env, url, parts, GROUP) {
  if (parts[0] !== 'game') return null;
  const g = request.method === 'GET', body = async () => { try { return (await request.json()) || {}; } catch (e) { return {}; } };
  if (g && parts[1] === 'me') return gameMe(env, url.searchParams.get('c') || '');
  if (g && parts[1] === 'ranking') return gameRanking(env, GROUP, url.searchParams.get('c') || '', url.searchParams.get('p') || 'month');
  if (request.method === 'POST') {
    if (parts[1] === 'register') return gameRegister(env, await body());
    if (parts[1] === 'login') return gameLogin(env, await body());
    if (parts[1] === 'logout') return gameLogout(env, await body());
    if (parts[1] === 'code') return gameNewCode(env, await body());
    if (parts[1] === 'delete') return gameDelete(env, await body());
  }
  return err('notfound', 404);
}
