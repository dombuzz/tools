// Like-Funktion für tools.dombuzz.ch – an einem Ort für alle Tools
// Einbinden: <script src="/like.js" defer></script> vor </body>
// Frage «Ha quest tool simplifitgà tia lavur?» unten im Tool und als Karte nach dem ersten Download.
// Ein Tool kann die Karte auch selbst auslösen: dispatchEvent(new Event('dbz-success'))
// Gezählt wird über den Cloudflare Worker (nur Tool-Name und Zeitpunkt), höchstens 5 Klicks pro Tool, Browser und Tag.
// Aufrufe: jeder Seitenaufruf wird gezählt (nur auf /stats sichtbar), dazu eine anonyme Zufalls-Kennung pro Browser (nur gesamthaft als «verschiedene Besucher» ausgewertet).
// Nutzung: beim ersten Resultat (Download, Kopie, «dbz-success») eine Meldung pro Seitenaufruf, unabhängig vom Like.

{ // eigener Block: keine Namen gelangen in den globalen Bereich der Tools
const CSS = `.dbz-like{max-width:640px;margin:36px auto 8px;padding:0 16px;text-align:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--muted,var(--mute,#9a9aa2))}
.dbz-like p{margin:0 0 10px}
.dbz-like button,.dbz-toast .dbz-yes{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line,var(--border,#2f2f34));background:transparent;color:var(--text,var(--ink,var(--fg,#ececef)));border-radius:999px;padding:8px 16px 8px 13px;font:inherit;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s}
.dbz-like button:hover,.dbz-toast .dbz-yes:hover{border-color:rgba(255,77,100,.6);background:rgba(255,77,100,.08)}
.dbz-like svg,.dbz-toast svg{width:18px;height:18px;flex:none}
.dbz-like svg path,.dbz-toast svg path{fill:none;stroke:var(--accent,var(--acc,#ff4d64));stroke-width:2}
.dbz-like button.done svg path,.dbz-toast .dbz-yes.done svg path{fill:var(--accent,var(--acc,#ff4d64))}
.dbz-like button:disabled{cursor:default;opacity:.55}
.dbz-like button:disabled:hover{border-color:var(--line,var(--border,#2f2f34));background:transparent}
.dbz-like button.pop svg,.dbz-toast .pop svg{animation:dbzpop .35s ease}
@keyframes dbzpop{40%{transform:scale(1.45)}100%{transform:scale(1)}}
.dbz-like .n{display:block;margin-top:8px;font-size:.82rem;min-height:1.2em;font-variant-numeric:tabular-nums}
/* Karte nach getaner Arbeit */
.dbz-toast{position:fixed;right:20px;bottom:20px;z-index:9999;width:340px;max-width:calc(100vw - 24px);background:var(--surface3,#26262a);border:1px solid var(--line,var(--border,#3a3a40));border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px var(--shadow,rgba(0,0,0,.6));font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text,var(--ink,var(--fg,#ececef)));opacity:0;transform:translateY(12px);transition:opacity .25s,transform .25s;pointer-events:none}
.dbz-toast.on{opacity:1;transform:none;pointer-events:auto}
.dbz-toast p{margin:0 28px 10px 0}
.dbz-toast .dbz-x{position:absolute;top:6px;right:8px;width:28px;height:28px;border:0;background:transparent;color:var(--muted,var(--mute,#9a9aa2));font-size:18px;line-height:1;cursor:pointer;border-radius:6px}
.dbz-toast .dbz-x:hover{color:var(--text,var(--ink,var(--fg,#ececef)));background:var(--line,var(--border,#2f2f34))}
.dbz-toast .dbz-row{display:flex;align-items:center;gap:12px}
.dbz-toast .dbz-yes{padding:6px 14px 6px 11px}
.dbz-toast small{color:var(--muted,var(--mute,#9a9aa2));font-size:.78rem}
@media (max-width:480px){.dbz-toast{left:12px;right:12px;bottom:12px;width:auto}}
/* Feedback (Propostas, giavischs, critica?) */
.dbz-fb{margin:22px auto 0;max-width:480px;text-align:left}
.dbz-fb summary{cursor:pointer;list-style:none;text-align:center;color:var(--accent,var(--acc,#ff4d64));opacity:.7;font-size:.9rem;transition:opacity .15s}
.dbz-fb summary::-webkit-details-marker{display:none}
.dbz-fb summary:hover,.dbz-fb summary:focus-visible,.dbz-fb[open] summary{opacity:1;outline:none}
.dbz-fb summary span{border-bottom:1px dashed currentColor}
.dbz-fb form{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.dbz-fb textarea,.dbz-fb input{width:100%;box-sizing:border-box;font:inherit;font-size:.92rem;color:var(--text,var(--ink,var(--fg,#ececef)));background:var(--mono,var(--card,#26262a));border:1px solid var(--line,var(--border,#2f2f34));border-radius:8px;padding:9px 11px}
.dbz-fb textarea{min-height:96px;resize:vertical}
.dbz-fb textarea:focus,.dbz-fb input:focus{outline:2px solid var(--accent,var(--acc,#ff4d64));outline-offset:1px}
.dbz-fb .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dbz-fb .row input{flex:1 1 180px;width:auto}
.dbz-fb button{padding:8px 16px}
.dbz-fb small{display:block;font-size:.78rem;color:var(--muted,var(--mute,#9a9aa2))}
.dbz-fb .msg{font-size:.85rem;min-height:1.2em}
.dbz-fb .msg.err{color:var(--err,#ff6b7d)}
@media (prefers-reduced-motion:reduce){.dbz-like button.pop svg,.dbz-toast .pop svg{animation:none}.dbz-toast{transition:none}}`;

const HTML = `<div class="dbz-like" id="dbz-like">
  <p>Ha quest tool simplifitgà tia lavur?</p>
  <button type="button"><svg viewBox="2 3 20 19" aria-hidden="true"><path d="M12 20s-7-4.3-9-8.6C1.6 8.2 3.6 4.8 7 4.8c2 0 3.4 1.1 4.1 2.5h1.8c.7-1.4 2.1-2.5 4.1-2.5 3.4 0 5.4 3.4 4 6.6-2 4.3-9 8.6-9 8.6z"/></svg>Gea</button>
  <span class="n" aria-live="polite"></span>
  <details class="dbz-fb">
    <summary><span>Propostas, giavischs, critica?</span></summary>
    <form>
      <textarea name="text" maxlength="1000" required placeholder="Tes messadi …" aria-label="Tes messadi"></textarea>
      <div class="row">
        <input name="name" maxlength="60" placeholder="Num (opziunal)" aria-label="Num (opziunal)">
        <button type="submit">Trametter</button>
      </div>
      <small>Senza num resta il messadi anonim.</small>
      <span class="msg" aria-live="polite"></span>
    </form>
  </details>
</div>
<div class="dbz-toast" id="dbz-toast" role="dialog" aria-label="Ha quest tool gidà?">
  <button type="button" class="dbz-x" aria-label="Serrar">×</button>
  <p>Ha quest tool simplifitgà tia lavur?</p>
  <div class="dbz-row">
    <button type="button" class="dbz-yes"><svg viewBox="2 3 20 19" aria-hidden="true"><path d="M12 20s-7-4.3-9-8.6C1.6 8.2 3.6 4.8 7 4.8c2 0 3.4 1.1 4.1 2.5h1.8c.7-1.4 2.1-2.5 4.1-2.5 3.4 0 5.4 3.4 4 6.6-2 4.3-9 8.6-9 8.6z"/></svg>Gea</button>
    <small aria-live="polite"></small>
  </div>
</div>`;
(() => {
  if (document.getElementById('dbz-like')) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  document.body.insertAdjacentHTML('beforeend', HTML);
  const API = 'https://fragrant-grass-c193.zappa-pfadi.workers.dev';
  // Tool-Kennung aus der Adresse: /Resizer2000 → Resizer2000, /lab/csv → lab-csv
  const segs = location.pathname.replace(/\.html?$/i, '').split('/').filter(Boolean);
  const tool = (segs[0] === 'lab' && segs.length > 1 ? 'lab-' : '') + (segs.at(-1) || 'index');
  let wasUsed = false; try { wasUsed = !!localStorage.getItem('dbz-visit-' + tool); } catch (e) {}
  try { localStorage.setItem('dbz-visit-' + tool, Date.now()); } catch (e) {} // für «nov» auf der Startseite
  // /game: Tage mit Tool-Nutzung merken (nur im Browser) und bei erneuter Nutzung die Serie zeigen
  (() => {
    const ymd = d => d.toLocaleDateString('sv'), today = ymd(new Date());
    let days = []; try { days = JSON.parse(localStorage.getItem('dbz-days') || '[]'); if (!Array.isArray(days)) days = []; } catch (e) {}
    if (!days.includes(today)) { days.push(today); days = days.slice(-400); try { localStorage.setItem('dbz-days', JSON.stringify(days)); } catch (e) {} }
    // Serie: Tage in Folge; Samstag/Sonntag ohne Nutzung unterbrechen sie nicht
    const set = new Set(days), d = new Date(); let n = 0;
    for (let i = 0; i < 400; i++, d.setDate(d.getDate() - 1)) { if (set.has(ymd(d))) n++; else if (d.getDay() % 6 !== 0) break; }
    try { if (n > (+localStorage.getItem('dbz-best') || 0)) localStorage.setItem('dbz-best', n); } catch (e) {}
    let game = false, shown = ''; try { game = localStorage.getItem('dbz-game') === '1'; shown = localStorage.getItem('dbz-serie-shown') || ''; } catch (e) {}
    if (!game || !wasUsed || n < 2 || shown === today) return; // einmal pro Tag, nur wer /game kennt
    try { localStorage.setItem('dbz-serie-shown', today); } catch (e) {}
    const st = document.createElement('style');
    st.textContent = '.dbz-serie{position:fixed;left:50%;top:16px;z-index:9999;transform:translate(-50%,-140%);display:flex;align-items:center;gap:10px;padding:10px 18px 10px 14px;border:1px solid var(--accent,var(--acc,#ff4d64));border-radius:999px;background:var(--card,#1c1c1f);color:var(--text,#ececef);font:600 15px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:transform .45s cubic-bezier(.2,1.4,.4,1);cursor:pointer;white-space:nowrap}.dbz-serie.on{transform:translate(-50%,0)}.dbz-serie b{font-size:22px;line-height:1}.dbz-serie small{display:block;color:var(--muted,#9a9aa2);font-weight:500;font-size:12px}@media (prefers-reduced-motion:reduce){.dbz-serie{transition:none}}';
    document.head.append(st);
    const el = document.createElement('div'); el.className = 'dbz-serie'; el.setAttribute('role', 'status');
    el.innerHTML = '<b>🔥</b><span>' + n + ' dis a la lunga<small>Turna damaun per cuntinuar</small></span>';
    document.body.append(el);
    const off = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 500); };
    el.addEventListener('click', off);
    setTimeout(() => el.classList.add('on'), 500);
    setTimeout(off, 4500);
  })();
  // Seitenaufruf zählen (einmal pro Aufruf; nur Tool-Name und Zeitpunkt)
  // Anonyme Zufalls-Kennung pro Browser (nur zum Zählen verschiedener Besucher, gilt für alle Tools gemeinsam)
  let cid = ''; try { cid = localStorage.getItem('dbz-cid') || ''; if (!/^[A-Za-z0-9-]{8,40}$/.test(cid)) { cid = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem('dbz-cid', cid); } } catch (e) { cid = ''; }
  fetch(API + '/view/' + encodeURIComponent(tool) + '?t=' + (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark') + (cid ? '&c=' + cid : ''), { method: 'POST', keepalive: true }).catch(() => {});
  const box = document.getElementById('dbz-like'), btn = box.querySelector('button'), out = box.querySelector('.n');
  const toast = document.getElementById('dbz-toast'), tBtn = toast.querySelector('.dbz-yes'), tOut = toast.querySelector('small');
  // in den Hauptbereich der Seite verschieben, damit der Block unter dem Tool steht
  const host = document.querySelector('body > .container, body > .wrap, body > main');
  if (host) host.append(box);
  const label = n => n ? (n === 1 ? 'Gidà 1 giada' : `Gidà ${n.toLocaleString('de-CH')} giadas`) : '';
  const show = n => { out.textContent = label(n); tOut.textContent = label(n); };
  fetch(API + '/likes').then(r => r.json()).then(d => show(d[tool] || 0)).catch(() => {});

  // Höchstens 5 Klicks pro Tool, Gerät (Browser) und Tag
  const LIMIT = 5, day = new Date().toLocaleDateString('sv'), key = `dbz-like-${tool}`;
  const used = () => { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v.day === day ? v.n : 0; } catch (e) { return 0; } };
  const use = () => { try { localStorage.setItem(key, JSON.stringify({ day, n: used() + 1 })); } catch (e) {} };
  const lim = document.createElement('span'); lim.className = 'n'; box.append(lim);
  const full = () => { btn.disabled = true; btn.classList.add('done'); btn.title = 'Turna damaun';
    lim.textContent = 'Ti has gia dà tes 5 cors per oz en quest tool – Grazia ♥️'; };
  if (used() >= LIMIT) full();

  function like(el) {
    if (used() >= LIMIT) { full(); return false; }
    use();
    el.classList.add('done', 'pop'); setTimeout(() => el.classList.remove('pop'), 400);
    btn.classList.add('done');
    fetch(API + '/like/' + encodeURIComponent(tool), { method: 'POST' })
      .then(r => r.json()).then(d => { if (d.count) { show(d.count); out.textContent += ' – grazia!'; tOut.textContent = 'Grazia!'; } })
      .catch(() => { out.textContent = tOut.textContent = 'Betg reussì – emprova pli tard.'; });
    if (used() >= LIMIT) full();
    return true;
  }
  btn.addEventListener('click', () => like(btn));

  // Karte nach getaner Arbeit: nach dem ersten Download (bzw. Ereignis «dbz-success»), pro Besuch einmal
  let asked = false, hideT;
  const hide = () => { toast.classList.remove('on'); clearTimeout(hideT); };
  const later = ms => { clearTimeout(hideT); hideT = setTimeout(hide, ms); };
  function ask() {
    if (asked || used() >= LIMIT) return;
    asked = true;
    setTimeout(() => { toast.classList.add('on'); later(15000); }, 1200);
  }
  toast.addEventListener('mouseenter', () => clearTimeout(hideT));
  toast.addEventListener('mouseleave', () => later(6000));
  toast.querySelector('.dbz-x').addEventListener('click', hide);
  tBtn.addEventListener('click', () => { if (like(tBtn)) later(2500); else hide(); });
  // Nutzung zählen: einmal pro Seitenaufruf
  let counted = false;
  function done() {
    if (!counted) { counted = true;
      try { const m = new Date().toLocaleDateString('sv').slice(0, 7), a = JSON.parse(localStorage.getItem('dbz-acts') || '{}') || {}; // für /game
        localStorage.setItem('dbz-acts', JSON.stringify({ total: (+a.total || 0) + 1, month: m, m: (a.month === m ? +a.m || 0 : 0) + 1 })); } catch (e) {}
      fetch(API + '/use/' + encodeURIComponent(tool) + (cid ? '?c=' + cid : ''), { method: 'POST', keepalive: true }).catch(() => {}); }
    ask();
  }
  // Downloads erkennen: Klick auf einen Download-Link oder a.click() im Skript
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a[download]')) done(); }, true);
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) done(); return origClick.apply(this, arguments); };
  window.addEventListener('dbz-success', done);

  // Feedback: geht an den Worker, ist nur auf der passwortgeschützten Seite /feedback lesbar
  const fb = box.querySelector('.dbz-fb form'), fbMsg = fb.querySelector('.msg'), fbBtn = fb.querySelector('button');
  fb.addEventListener('submit', async e => {
    e.preventDefault();
    const text = fb.elements.text.value.trim(); if (!text) return;
    fbBtn.disabled = true; fbMsg.className = 'msg'; fbMsg.textContent = 'Vegn tramess …';
    try {
      const r = await fetch(API + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, text, name: fb.elements.name.value.trim() }) });
      if (r.status === 429) throw new Error('Ti has gia tramess plirs messadis oz – emprova damaun.');
      if (!r.ok) throw new Error('Betg reussì – emprova pli tard.');
      fb.reset(); fbMsg.textContent = 'Grazia fitg! Tes messadi è arrivà.';
    } catch (err) { fbMsg.className = 'msg err'; fbMsg.textContent = err.message || 'Betg reussì – emprova pli tard.'; }
    fbBtn.disabled = false;
  });
})();
}
