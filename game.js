// Spiel-Ebene für /game: Collecziun (entdeckte Tools), Seria (Tage in Folge), Acziuns und Badges.
// Alles bleibt im Browser (localStorage); Daten sammelt like.js auf den Tool-Seiten:
//   dbz-visit-<tool>  Zeitpunkt des letzten Besuchs (gibt es schon für «nov»)
//   dbz-days          Tage mit Tool-Nutzung (JJJJ-MM-TT)
//   dbz-best          längste Serie
//   dbz-acts          Aktionen (Downloads usw.): { total, month, m }
// Keine Ranglisten, nichts wird an andere Personen gezeigt.
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
  .gbar i { background: var(--rgrad); box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent); }`;
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
      <p class="gtip" id="gtip" aria-live="polite">Tippa sin in badge per vesair la cundiziun.</p>
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

  // Balken einblenden
  requestAnimationFrame(() => setTimeout(() => {
    const [b1, b2] = sec.querySelectorAll('.gbar i');
    b1.style.width = pct + '%';
    b2.style.width = b2.dataset.w + '%';
  }, 60));
})();
