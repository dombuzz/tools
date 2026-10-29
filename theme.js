// Modus test: eigene Funktionstests nicht in der Statistik zählen (gilt pro Browser, bis man ihn ausschaltet)
// Einschalten: eine beliebige Seite mit ?test öffnen (z. B. tools.dombuzz.ch/visual?test), ausschalten mit ?test=0
// oder mit dem ✕ am Hinweis unten links. Im Testmodus werden Aufrufe, Nutzungen, Likes und Favoriten nicht an den Worker geschickt.
(function () {
  var K = 'dbz-test', u = new URL(location.href), p = u.searchParams.get('test');
  try {
    if (p !== null) {
      if (p === '0' || p === 'off') localStorage.removeItem(K); else localStorage.setItem(K, '1');
      u.searchParams.delete('test'); history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
    if (localStorage.getItem(K) !== '1') return;
  } catch (e) { return; }
  window.dbzTest = true;
  var f = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (m === 'POST' && /\.workers\.dev\//.test(url))
      return Promise.resolve(new Response('{"ok":true,"test":true}', { headers: { 'Content-Type': 'application/json' } }));
    return f.apply(this, arguments);
  };
  var show = function () {
    if (document.getElementById('dbz-testbadge')) return;
    var b = document.createElement('div'); b.id = 'dbz-testbadge';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 11px;border-radius:999px;background:#ffb86b;color:#121214;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    b.innerHTML = '<span>Modus test – betg dumbrà</span><button type="button" title="Terminar il modus test" aria-label="Terminar il modus test" style="border:0;background:rgba(0,0,0,.15);color:inherit;border-radius:999px;width:20px;height:20px;padding:0;font:700 12px/1 system-ui;cursor:pointer">✕</button>';
    b.querySelector('button').onclick = function () { try { localStorage.removeItem(K); } catch (e) {} location.reload(); };
    document.body.appendChild(b);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
})();

// Hell/Dunkel für tools.dombuzz.ch – an einem Ort für alle Tools
// Einbinden: <script src="/theme.js"></script> ganz oben im <head> (ohne defer, damit nichts aufblitzt)
// Wählt anhand des Gerätemodus (prefers-color-scheme) und bietet oben rechts einen kleinen Umschalter.
// Die Wahl wird im Browser gespeichert (dbz-theme). Pages lesen die Farben aus CSS-Variablen; Seiten mit Canvas/Charts
// hören auf das Ereignis «dbz-theme» (window.dbzTheme() liefert 'light' oder 'dark').
(function () {
  var d = document, r = d.documentElement, mq = matchMedia('(prefers-color-scheme: light)');
  var saved = function () { try { var t = localStorage.getItem('dbz-theme'); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } };
  r.dataset.theme = saved() || (mq.matches ? 'light' : 'dark');
  window.dbzTheme = function () { return r.dataset.theme; };

  var css = ':root{--on-accent:#121214;--on-sel:#fff;--surface2:#18181b;--surface3:#202024;--dim:#6a6a72;--shadow:rgba(0,0,0,.55);--lab:#ff9a3c;--wash:rgba(255,77,100,.08);--warn-text:#ffd2a8;--ok-text:#8fd9a8}' +
    ':root[data-theme="light"]{color-scheme:light;' +
    '--bg:#f4f4f7;--card:#fff;--panel:#fff;--field:#ececf1;--text:#1c1c20;--ink:#1c1c20;--fg:#1c1c20;' +
    '--muted:#686872;--mute:#686872;--line:#dcdce3;--border:#dcdce3;' +
    '--accent:#d02843;--acc:#d02843;--accent-dark:#ad1c34;--acc2:#ad1c34;--link:#c4243f;--accent-ink:#fff;--on-accent:#fff;' +
    '--mono:#e9e9ef;--code:#e9e9ef;--ok:#2a8a50;--warn:#a8650a;--err:#c81d3a;--bad:#c81d3a;' +
    '--ok-bg:#dff3e6;--warn-bg:#faedd2;--err-bg:#fadde1;--lab:#c9650a;' +
    '--surface2:#f0f0f4;--surface3:#e6e6ec;--dim:#8a8a94;--shadow:rgba(30,30,40,.18);--wash:rgba(208,40,67,.08);--warn-text:#7a4208;--ok-text:#1c6b3a}' +
    /* Auswahl-Elemente: bei Hover und Auswahl weisser Text, sonst dunkel */
    '.seg button,.ratio-seg button,.ptab,.tab,.tabs button,.ctog button,.wseg button,.tool,.seg input+label{color:var(--text)}' +
    '.seg button:hover,.seg button[aria-pressed="true"],.ratio-seg button:hover,.ratio-seg button.active,.ptab:hover,.ptab[aria-selected="true"],.tab:hover,.tab[aria-selected="true"],' +
    '.tabs button:hover,.tabs button[aria-selected="true"],.ctog button:hover,.ctog button[aria-pressed="true"],' +
    '.wseg button:hover,.wseg button[aria-pressed="true"],.tool:hover,.tool[aria-pressed="true"],.seg input:checked+label,.seg input+label:hover' +
    '{background:var(--accent)!important;border-color:var(--accent)!important;color:#fff!important}' +
    '.themebtn{position:fixed;top:12px;right:12px;z-index:50;width:32px;height:32px;padding:0;display:grid;place-items:center;border-radius:50%;' +
    'border:1px solid var(--line,#2f2f34);background:var(--card,#1c1c1f);color:var(--muted,#9a9aa2);cursor:pointer;opacity:.7;transition:opacity .15s,border-color .15s,color .15s;box-shadow:none}' +
    '.themebtn:hover,.themebtn:focus-visible{opacity:1;color:var(--text,#ececef);border-color:var(--accent,#ff4d64);background:var(--field,#26262a)}' +
    '.themebtn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    /* Tastatur: sichtbarer Fokus-Rahmen überall (nur bei Tastaturbedienung), einheitlich */
    ':where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:2px solid var(--accent,#ff4d64)!important;outline-offset:2px}' +
    '.themebtn:focus-visible{outline-offset:2px}' +
    /* Wer am Gerät «Bewegung reduzieren» eingestellt hat, bekommt keine Animationen */
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}' +
    '@media print{.themebtn{display:none}}';
  var s = d.createElement('style'); s.id = 'dbz-theme-css'; s.textContent = css; (d.head || r).appendChild(s);

  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var btn;
  function paint() {
    var light = r.dataset.theme === 'light';
    // Beschriftung nennt die Darstellung, zu der ein Klick wechselt
    var label = light ? 'Empernaivel' : 'Tschorventar';
    if (btn) { btn.innerHTML = light ? MOON : SUN; btn.title = label; btn.setAttribute('aria-label', label); }
    var m = d.querySelector('meta[name="theme-color"]'); if (m) m.content = light ? '#f4f4f7' : '#121214';
    window.dispatchEvent(new CustomEvent('dbz-theme', { detail: r.dataset.theme }));
  }
  function set(t, store) {
    r.dataset.theme = t;
    if (store) { try { localStorage.setItem('dbz-theme', t); } catch (e) {} }
    paint();
  }
  function mount() {
    btn = d.createElement('button'); btn.type = 'button'; btn.className = 'themebtn';
    btn.addEventListener('click', function () { set(r.dataset.theme === 'light' ? 'dark' : 'light', true); });
    d.body.appendChild(btn); paint();
  }
  if (d.body) mount(); else d.addEventListener('DOMContentLoaded', mount);
  // Pfeiltasten in Tab-Leisten und Auswahlgruppen (role=tablist / radiogroup): links/rechts wechselt und wählt, Pos1/Ende springen
  d.addEventListener('keydown', function (e) {
    var k = e.key; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(k) < 0) return;
    var t = e.target; if (!t || !t.closest) return;
    var grp = t.closest('[role="tablist"],[role="radiogroup"]'); if (!grp) return;
    var items = [].slice.call(grp.querySelectorAll('button,[role="tab"],[role="radio"]')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
    var i = items.indexOf(t); if (i < 0) return;
    var n = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : (i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    e.preventDefault(); items[n].focus(); items[n].click();
  });
  // Installierbar + offline: Service Worker (sw.js) anmelden
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  var onChange = function (e) { if (!saved()) set(e.matches ? 'light' : 'dark', false); };
  if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
})();

// Anonyme Zufalls-Kennung pro Browser (nur zum Zählen verschiedener Besucher; gilt für alle Seiten gemeinsam)
window.dbzCid = function () {
  var c = ''; try {
    c = localStorage.getItem('dbz-cid') || '';
    if (!/^[A-Za-z0-9-]{8,40}$/.test(c)) { c = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('dbz-cid', c); }
  } catch (e) { c = ''; }
  return c;
};
