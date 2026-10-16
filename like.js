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
@media (prefers-reduced-motion:reduce){.dbz-like button.pop svg,.dbz-toast .pop svg{animation:none}.dbz-toast{transition:none}}`;

const HTML = `<div class="dbz-like" id="dbz-like">
  <p>Ha quest tool simplifitgà tia lavur?</p>
  <button type="button"><svg viewBox="2 3 20 19" aria-hidden="true"><path d="M12 20s-7-4.3-9-8.6C1.6 8.2 3.6 4.8 7 4.8c2 0 3.4 1.1 4.1 2.5h1.8c.7-1.4 2.1-2.5 4.1-2.5 3.4 0 5.4 3.4 4 6.6-2 4.3-9 8.6-9 8.6z"/></svg>Gea</button>
  <span class="n" aria-live="polite"></span>
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
    if (!counted) { counted = true; fetch(API + '/use/' + encodeURIComponent(tool), { method: 'POST', keepalive: true }).catch(() => {}); }
    ask();
  }
  // Downloads erkennen: Klick auf einen Download-Link oder a.click() im Skript
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a[download]')) done(); }, true);
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) done(); return origClick.apply(this, arguments); };
  window.addEventListener('dbz-success', done);
})();
}
