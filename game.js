// Spiel-Ebene für /game: Collecziun (entdeckte Tools), Seria (Tage in Folge), Acziuns und Badges.
// Alles bleibt im Browser (localStorage); Daten sammelt like.js auf den Tool-Seiten:
//   dbz-visit-<tool>  Zeitpunkt des letzten Besuchs (gibt es schon für «nov»)
//   dbz-days          Tage mit Tool-Nutzung (JJJJ-MM-TT)
//   dbz-best          längste Serie
//   dbz-acts          Aktionen (Downloads usw.): { total, month, m }
// Rangliste: nur mit eigenem Profil (Name + Wiederherstellungscode, Worker /game/*). Ohne Profil bleibt alles lokal und niemand sieht etwas.
(() => {
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lj = (k, d) => { try { return JSON.parse(ls(k, '')) ?? d; } catch (e) { return d; } };
  try { localStorage.setItem('dbz-game', '1'); } catch (e) {} // ab jetzt zeigen die Tools das Serien-Popup

  // Serie: Tage in Folge mit Tool-Nutzung; Samstag/Sonntag ohne Nutzung unterbrechen sie nicht
  const ymd = d => d.toLocaleDateString('sv');
  const streak = days => {
    const set = new Set(days), d = new Date();
    if (!set.has(ymd(d))) d.setDate(d.getDate() - 1); // heute noch nichts: Serie von gestern zählt noch
    let n = 0;
    for (let i = 0; i < 400; i++, d.setDate(d.getDate() - 1)) {
      if (set.has(ymd(d))) n++;
      else if (d.getDay() % 6 !== 0) break;
    }
    return n;
  };

  const css = `
  :root:root { --accent: #5aa6ff; --acc: #5aa6ff; --link: #5aa6ff; }
  :root:root[data-theme="light"] { --accent: #1f6fd1; --acc: #1f6fd1; --accent-dark: #1857a8; --acc2: #1857a8; --link: #1a63bd; }
  #vnum::after { content: none !important; } /* kein «·» nach der Versionsnummer, der game-Link fehlt hier */
  .homelink { display: inline-block; margin: 0 0 10px; font-size: .85rem; color: var(--muted); text-decoration: none; }
  .homelink:hover, .homelink:focus-visible { color: var(--accent); }
  .h1g { display: inline-block; margin-left: 8px; padding: 1px 8px; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; vertical-align: 6px; }
  .game { margin-top: 28px; display: grid; gap: 10px; }
  .gcard { padding: 14px 16px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
  .gh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 10px; }
  .gh b { font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .gh span { color: var(--muted); font-size: 13px; }
  .gbar { height: 6px; border-radius: 99px; background: var(--field); overflow: hidden; }
  .gbar i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width .6s; }
  .gtools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .gt { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--text); font-size: 12.5px; text-decoration: none; }
  .gt.on { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .gt.on::before { content: "✓ "; color: var(--accent); font-weight: 700; }
  .gt.off { border-style: dashed; color: var(--muted); }
  .gt:hover, .gt:focus-visible { border-color: var(--accent); outline: none; }
  .gbig { display: flex; align-items: baseline; gap: 10px; }
  .gbig strong { font-size: 30px; line-height: 1; letter-spacing: -.02em; }
  .gbig small { color: var(--muted); font-size: 13px; }
  .gnote { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; }
  .gins { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .gi { font: inherit; background: none; cursor: pointer; padding: 8px 6px; border-radius: 10px; border: 1px solid var(--line); text-align: center; font-size: 11.5px; line-height: 1.3; color: var(--muted); }
  .gi em { display: block; font-style: normal; font-size: 20px; line-height: 1.2; filter: grayscale(1); opacity: .35; }
  .gi.on { color: var(--text); border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .gi.on em { filter: none; opacity: 1; }
  .gi:hover, .gi:focus-visible, .gi.sel { border-color: var(--accent); outline: none; }
  .gtip { margin: 10px 0 0; min-height: 2.9em; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .gtip b { color: var(--text); font-weight: 600; }
  .gtip span { display: block; color: var(--accent); font-size: 12px; font-weight: 600; }
  /* Verlauf und Milchglas wie in den Tools (theme.js), hier in Blau: --rgrad wird aus der blauen Akzentfarbe berechnet */
  .gcard { background: var(--glass); -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2); border-color: var(--glass-line); }
  .gh b, .gtip span, .h1g, .gt.on::before { background-image: var(--rgrad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .gbar i { background: var(--rgrad); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent); }
  .gp { display: grid; gap: 8px; }
  .gp p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .gp form { display: flex; flex-wrap: wrap; gap: 6px; }
  .gp input { font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--field); color: var(--text); min-width: 0; flex: 1 1 140px; }
  .gp input:focus-visible { outline: none; border-color: var(--accent); }
  .gb { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--accent); background: none; color: var(--accent); cursor: pointer; }
  .gb.q { border-color: var(--line); color: var(--muted); }
  .gb:hover, .gb:focus-visible { background: color-mix(in srgb, var(--accent) 14%, transparent); outline: none; }
  .gcode { font-family: ui-monospace, monospace; font-size: 22px; letter-spacing: .12em; padding: 8px 12px; border: 1px dashed var(--accent); border-radius: 10px; width: fit-content; user-select: all; }
  .gerr { color: #ff7a7a; font-size: 13px; min-height: 1em; }
  .grk { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .grk th { text-align: right; color: var(--muted); font-weight: 600; font-size: 11.5px; padding: 4px 6px; cursor: pointer; white-space: nowrap; }
  .grk th:nth-child(2) { text-align: left; }
  .grk th.on { color: var(--accent); }
  .grk td { padding: 6px; border-top: 1px solid var(--line); text-align: right; font-variant-numeric: tabular-nums; }
  .grk td:nth-child(1) { text-align: left; color: var(--muted); width: 1%; }
  .grk td:nth-child(2) { text-align: left; }
  .grk tr.me td { background: color-mix(in srgb, var(--accent) 12%, transparent); font-weight: 600; }
  .grk td.pt { font-weight: 700; }
  .gper { display: flex; gap: 6px; }
  .gper button { font: inherit; font-size: 12.5px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: none; color: var(--muted); cursor: pointer; }
  .gper button.on { border-color: var(--accent); color: var(--accent); }
  .grules { margin-top: 8px; font-size: 12.5px; color: var(--muted); } .grules summary { cursor: pointer; } .grules ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.5; }
  .gl { font-size: 12.5px !important; } .gl b { color: var(--text); font-weight: 600; }
  .gx { display: flex; gap: 6px; flex-wrap: wrap; }
  .gtp { position: relative; display: inline-block; margin-left: 6px; width: 15px; height: 15px; line-height: 14px; text-align: center; border: 1px solid var(--line); border-radius: 50%; font-size: 10px; font-weight: 700; font-style: normal; color: var(--muted); cursor: help; vertical-align: 1px; text-transform: none; letter-spacing: 0; -webkit-text-fill-color: currentColor; }
  .gtp::after { content: attr(data-tip); position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); width: 230px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--glass-line, var(--line)); background: var(--card); box-shadow: 0 6px 20px rgba(0,0,0,.35); color: var(--text); font-size: 12.5px; font-weight: 400; line-height: 1.4; text-align: left; opacity: 0; pointer-events: none; transition: opacity .15s; z-index: 5; }
  .gtp:hover::after, .gtp:focus-visible::after { opacity: 1; }
  .gtp:hover, .gtp:focus-visible { color: var(--accent); border-color: var(--accent); outline: none; }`;
  document.head.insertAdjacentHTML('beforeend', '<style>' + css + '</style>');

  // Unten kein «game»-Link; dafür zuoberst der Weg zurück zur Startseite (wie in den Tools)
  const vg = document.getElementById('vgame');
  if (vg) vg.remove();

  const head = document.querySelector('main .head');
  if (head) head.insertAdjacentHTML('beforebegin', '<a class="homelink" href="/">← Tools</a>');

  const h1 = document.querySelector('h1');
  if (h1) h1.insertAdjacentHTML('beforeend', '<span class="h1g">game</span>');

  // alle Tools aus dem Dropdown (ohne Lab und externe Links)
  const tools = [...document.querySelectorAll('#menu a.mi:not(.lab)')]
    .map(a => ({ key: (a.getAttribute('href') || '').replace(/^\//, ''), name: (n => { n.querySelectorAll('.star, .nov, .dot').forEach(x => x.remove()); return n.textContent.trim(); })(a.cloneNode(true)), href: a.getAttribute('href') }))
    .filter((t, i, all) => /^[A-Za-z0-9-]+$/.test(t.key) && all.findIndex(x => x.key === t.key) === i);
  const seen = tools.filter(t => ls('dbz-visit-' + t.key, null));
  // Nutzungstage: Tagesliste aus like.js plus die Tage der letzten Besuche pro Tool (Daten von vor dem Start von /game)
  const days = [...new Set([...(Array.isArray(lj('dbz-days', [])) ? lj('dbz-days', []) : []),
    ...tools.map(t => +ls('dbz-visit-' + t.key, 0)).filter(Boolean).map(ms => ymd(new Date(ms)))])];
  const cur = streak(days), nDays = days.length; // nDays: verschiedene Tage, nicht zwingend nacheinander
  const best = Math.max(+ls('dbz-best', 0) || 0, cur);
  const acts = lj('dbz-acts', {}) || {}, month = new Date().toLocaleDateString('sv').slice(0, 7);
  const total = +acts.total || 0, mon = acts.month === month ? +acts.m || 0 : 0;
  const pct = tools.length ? Math.round(seen.length / tools.length * 100) : 0;

  const STEPS = [10, 25, 50, 100, 250, 500, 1000];
  const next = STEPS.find(s => s > total) || total;
  const prev = [...STEPS].reverse().find(s => s <= total) || 0;

  // Badges: [Symbol, Name, erreicht?, Bedingung, aktueller Stand, Ziel]
  const half = Math.ceil(tools.length / 2);
  const INS = [
    ['🧭', 'Emprim tool', seen.length, 1, 'Avra tes emprim tool.'],
    ['🗺️', 'Mez scuvrì', seen.length, half, `Scuvra almain la mesadad dals tools (${half} da ${tools.length}).`],
    ['🏆', 'Tut scuvrì', seen.length, tools.length, `Scuvra tut ils ${tools.length} tools.`],
    ['🔥', '3 dis', best, 3, 'Dovra tools 3 dis a la lunga.'],
    ['⚡', '7 dis', nDays, 7, 'Dovra tools a 7 dis differents – er cun pausas.'],
    ['🌋', '30 dis', nDays, 30, 'Dovra tools a 30 dis differents – er cun pausas.'],
    ['✦', '10 acziuns', total, 10, 'Fa 10 acziuns en ils tools (p.ex. download u export).'],
    ['✸', '100 acziuns', total, 100, 'Fa 100 acziuns en ils tools (p.ex. download u export).'],
    ['💎', '500 acziuns', total, 500, 'Fa 500 acziuns en ils tools (p.ex. download u export).'],
  ].map(([e, n, have, goal, rule]) => ({ e, n, rule, on: goal > 0 && have >= goal,
    state: goal > 0 && have >= goal ? '✓ Cuntanschì' : `Anc ${Math.max(goal - have, 0).toLocaleString('de-CH')} · ${Math.min(have, goal).toLocaleString('de-CH')} da ${goal.toLocaleString('de-CH')}` }));
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const sec = document.createElement('section');
  sec.className = 'game';
  sec.innerHTML = `
    <div class="gcard">
      <div class="gh"><b>Collecziun</b><span>${seen.length} da ${tools.length} tools scuvrids</span></div>
      <div class="gbar"><i style="width:0"></i></div>
      <div class="gtools">${tools.map(t => `<a class="gt ${seen.includes(t) ? 'on' : 'off'}" href="${esc(t.href)}">${esc(t.name)}</a>`).join('')}</div>
    </div>
    <div class="gcard">
      <div class="gh"><b>Seria</b><span>Record: ${best} ${best === 1 ? 'di' : 'dis'}</span></div>
      <div class="gbig"><strong>${cur ? '🔥 ' + cur : '–'}</strong><small>${cur ? (cur === 1 ? 'di' : 'dis a la lunga') : 'Avra in tool per cumenzar ina seria.'}</small></div>
      <p class="gnote">Sonda e dumengia na rumpan betg la seria.</p>
    </div>
    <div class="gcard">
      <div class="gh"><b>Acziuns</b><span>Quest mais: ${mon}</span></div>
      <div class="gbig"><strong>${total.toLocaleString('de-CH')}</strong><small>en tut · proxim badge tar ${next.toLocaleString('de-CH')}</small></div>
      <div class="gbar" style="margin-top:10px"><i style="width:0" data-w="${next > prev ? Math.round((total - prev) / (next - prev) * 100) : 100}"></i></div>
    </div>
    <div class="gcard">
      <div class="gh"><b>Badges</b><span>${INS.filter(x => x.on).length} da ${INS.length}</span></div>
      <div class="gins">${INS.map((b, i) => `<button type="button" class="gi${b.on ? ' on' : ''}" data-i="${i}" title="${esc(b.rule + ' – ' + b.state)}" aria-describedby="gtip"><em>${b.e}</em>${b.n}</button>`).join('')}</div>
      <p class="gtip" id="gtip" aria-live="polite">Tippar sin in badge per vesair las cundiziuns.</p>
    </div>`;
  const anchor = document.querySelector('.favs') || document.getElementById('selwrap');
  anchor.after(sec);
  // Badges: Bedingung bei Hover, Fokus oder Klick unter dem Raster zeigen
  const tip = sec.querySelector('.gtip'), tip0 = tip.textContent, btns = sec.querySelectorAll('.gi');
  let pinned = -1;
  const showTip = i => {
    btns.forEach((b, j) => b.classList.toggle('sel', j === i && pinned === i));
    if (i < 0) { tip.textContent = tip0; return; }
    const b = INS[i];
    tip.innerHTML = `<b>${esc(b.e + ' ' + b.n)}:</b> ${esc(b.rule)}<span>${esc(b.state)}</span>`;
  };
  btns.forEach(el => {
    const i = +el.dataset.i;
    el.addEventListener('mouseenter', () => showTip(i));
    el.addEventListener('mouseleave', () => showTip(pinned));
    el.addEventListener('focus', () => showTip(i));
    el.addEventListener('click', () => { pinned = pinned === i ? -1 : i; showTip(pinned < 0 ? i : pinned); });
  });

  // ---- Profil und Rangliste (Worker) ----
  const API = 'https://fragrant-grass-c193.zappa-pfadi.workers.dev';
  const cid = (window.dbzCid && window.dbzCid()) || '';
  const call = (path, body) => fetch(API + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: cid, ...body }) })
    .then(r => r.json().then(d => ({ ok: r.ok, ...d }))).catch(() => ({ ok: false, error: 'net' }));
  const ERR = { name: 'Num: 2–24 caracters (bustabs, tschiffras, spazi, . _ - ’).', taken: 'Quest num exista gia.', already: 'Quest apparat ha gia in profil.', login: 'Num u code èn sbagliads.', limit: 'Memia blers empruvs. Spetga in mument.', full: 'Il dumber maximal da profils è cuntanschì.', net: 'Nagina colliaziun cun il server.', origin: 'Betg permess.', cid: 'Nagina identificaziun dal apparat.' };
  const pcard = document.createElement('div'), rcard = document.createElement('div');
  pcard.className = rcard.className = 'gcard';
  sec.append(pcard, rcard);
  const fmt = n => (+n).toLocaleString('de-CH');
  let me = null, per = 'month', sortK = 'pts', cache = {};

  const drawProfile = (code) => {
    if (!cid) { pcard.innerHTML = '<div class="gh"><b>Profil</b></div><p class="gnote">Memorisaziun localmain bloccada.</p>'; return; }
    if (me) {
      pcard.innerHTML = `<div class="gh"><b>Profil</b><span>${esc(me.name)}</span></div><div class="gp">
        ${code ? `<p>Tes code da restaurar e «re-annunziar» (vegn mussà be questa giada – al arcunescha bain!):</p><div class="gcode">${esc(code)}</div><p>Cun num + code pos ti avrir tes profil sin in auter apparat.</p>` : '<p>Ti es en la glista da rang.</p>'}
        <div class="gx"><button class="gb q" data-a="code">Nov code</button><button class="gb q" data-a="out">Ir or</button><button class="gb q" data-a="del">Stizzar profil</button></div><div class="gerr"></div></div>`;
    } else {
      pcard.innerHTML = `<div class="gh"><b>Profil<i class="gtp" tabindex="0" data-tip="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista." aria-label="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista.">i</i></b><span>sut profil na vesas ti nagina glista</span></div><div class="gp">
        <p>Fa in profil (be in num, nagina e-mail) per participar a la glista da rang. Il code da recuperaziun survegn ti ina giada.</p>
        <p class="gl"><b>Nov profil:</b> «Tes num» è il num che las autras persunas vesan en la glista da rang. Ti pos eleger el libramain (2–24 caracters), el na dastga anc betg exister.</p>
        <form data-f="reg"><input name="name" maxlength="24" placeholder="Tes num" title="Tes nov num da visur en la glista da rang (anc betg occupà)" autocomplete="nickname" required><button class="gb">Crear profil</button></form>
        <p class="gl"><b>Gia in profil?</b> «Num» è il num dal profil existent, ensemen cun il code da recuperaziun. Uschia avras ti il medem profil sin in auter apparat.</p>
        <form data-f="log"><input name="name" maxlength="24" placeholder="Num" title="Num dal profil existent (betg in nov num)" autocomplete="off" required><input name="code" maxlength="12" placeholder="Code (XXXX-XXXX)" autocomplete="off" required><button class="gb q">Avrir profil</button></form>
        <div class="gerr"></div></div>`;
    }
  };
  pcard.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f)), er = pcard.querySelector('.gerr');
    const r = await call('/game/' + (f.dataset.f === 'reg' ? 'register' : 'login'), d);
    if (!r.ok) { er.textContent = ERR[r.error] || 'Errur.'; return; }
    me = { name: r.name }; cache = {}; drawProfile(r.code); loadRank();
  });
  pcard.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return; const er = pcard.querySelector('.gerr');
    if (a.dataset.a === 'code') { if (!confirm('Generar in nov code? Il vegl code na vala lura betg pli.')) return; const r = await call('/game/code', {}); if (r.ok) drawProfile(r.code); else er.textContent = 'Errur.'; }
    if (a.dataset.a === 'out') { await call('/game/logout', {}); me = null; cache = {}; drawProfile(); drawRank(); }
    if (a.dataset.a === 'del') { if (!confirm('Stizzar il profil definitivamain?')) return; const r = await call('/game/delete', {}); if (r.ok) { me = null; cache = {}; drawProfile(); drawRank(); } else er.textContent = 'Errur.'; }
  });

  const COLS = [['pts', 'Puncts'], ['seria', 'Seria'], ['coll', 'Collecziun'], ['acts', 'Acziuns'], ['art', 'Artitgels']];
  const PN = { month: 'Quest mais', year: 'Quest onn', all: 'Tut' };
  const RULES = `<details class="grules"><summary>Sco vegnan ils puncts calculads?</summary><ul>
    <li><b>5</b> puncts per di cun tool duvrà</li><li><b>1</b> punct per acziun (max. 20 per di)</li>
    <li><b>10</b> puncts per tool scuvrì (ina giada)</li><li><b>3</b> puncts per artitgel avert en l’Artitgel-challenge (max. 3 per di)</li>
    <li><b>20</b> puncts per badge</li><li>Bonus per la megliera seria: <b>15</b> (3 dis), <b>40</b> (7 dis), <b>150</b> (30 dis)</li>
    <li>Sonda e dumengia na rumpan la seria. Apparats en il modus test na vegnan betg quintads.</li></ul></details>`;
  const drawRank = (d) => {
    if (!me) { rcard.innerHTML = '<div class="gh"><b>Glista da rang<i class="gtp" tabindex="0" data-tip="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista." aria-label="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista.">i</i></b></div><p class="gnote">Crea in profil per vesair la glista da rang.</p>'; return; }
    if (!d) { rcard.innerHTML = '<div class="gh"><b>Glista da rang<i class="gtp" tabindex="0" data-tip="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista." aria-label="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista.">i</i></b></div><p class="gnote">Chargia …</p>'; return; }
    const rows = d.rows.slice().sort((a, b) => b[sortK] - a[sortK] || b.pts - a.pts || a.name.localeCompare(b.name));
    rcard.innerHTML = `<div class="gh"><b>Glista da rang<i class="gtp" tabindex="0" data-tip="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista." aria-label="Be tgi che ha atgnamain in profil, vesa la glista \u2013 e be profils cumparan en la glista.">i</i></b><span>${rows.length} ${rows.length === 1 ? 'persuna' : 'persunas'}</span></div>
      <div class="gper">${Object.entries(PN).map(([k, v]) => `<button data-p="${k}" class="${k === per ? 'on' : ''}">${v}</button>`).join('')}</div>
      <table class="grk"><thead><tr><th></th><th>Num</th>${COLS.map(([k, v]) => `<th data-s="${k}" class="${k === sortK ? 'on' : ''}">${v}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td>${COLS.map(([k]) => `<td class="${k === 'pts' ? 'pt' : ''}">${fmt(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>${RULES}`;
  };
  rcard.addEventListener('click', e => {
    const p = e.target.closest('[data-p]'), s2 = e.target.closest('[data-s]');
    if (p) { per = p.dataset.p; loadRank(); }
    if (s2) { sortK = s2.dataset.s; drawRank(cache[per]); }
  });
  const loadRank = async () => {
    if (!me) return drawRank();
    if (cache[per] && Date.now() - cache[per].t < 6e4) return drawRank(cache[per].d);
    drawRank();
    const r = await call('/game/ranking?c=' + encodeURIComponent(cid) + '&p=' + per);
    if (!r.ok) { rcard.querySelector('.gnote').textContent = 'Glista betg chargiabla.'; return; }
    cache[per] = { t: Date.now(), d: r }; drawRank(r);
  };
  drawProfile(); drawRank();
  fetch(API + '/game/me?c=' + encodeURIComponent(cid)).then(r => r.json()).then(d => { me = d.profile || null; drawProfile(); loadRank(); }).catch(() => {});

  // Balken einblenden
  requestAnimationFrame(() => setTimeout(() => {
    const [b1, b2] = sec.querySelectorAll('.gbar i');
    b1.style.width = pct + '%';
    b2.style.width = b2.dataset.w + '%';
  }, 60));
})();
