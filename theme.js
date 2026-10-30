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
  // Gerät beim Worker als Test-Gerät melden: alle bisherigen Einträge dieses Browsers fallen aus der Statistik (auch rückwirkend)
  setTimeout(function () { var c = window.dbzCid && dbzCid(); if (c) f('https://fragrant-grass-c193.zappa-pfadi.workers.dev/exclude?c=' + encodeURIComponent(c), { method: 'POST', keepalive: true }).catch(function () {}); }, 0);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (m === 'POST' && /\.workers\.dev\//.test(url) && !/\/(feedback|backup)(\/|$|\?)/.test(url)) // Feedback und Backup sind keine Statistik und gehen auch im Testmodus durch
      return Promise.resolve(new Response('{"ok":true,"test":true}', { headers: { 'Content-Type': 'application/json' } }));
    return f.apply(this, arguments);
  };
  var show = function () {
    if (document.getElementById('dbz-testbadge')) return;
    var b = document.createElement('div'); b.id = 'dbz-testbadge';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:8px;padding:5px 6px 5px 11px;border-radius:999px;background:#ffb86b;color:#121214;border:2px solid #ff4d64;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    var onDash = /^\/(dashboard|stats)(\.html)?\/?$/.test(location.pathname);
    b.innerHTML = '<span>Conturn da test – naginas statisticas</span>' +
      (onDash ? '' : '<a href="/dashboard" title="Avrir il dashboard" style="color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px;white-space:nowrap">Dashboard →</a>') +
      '<button type="button" title="Terminar il conturn da test" aria-label="Terminar il conturn da test" style="border:0;background:rgba(0,0,0,.15);color:inherit;border-radius:999px;width:20px;height:20px;padding:0;font:700 12px/1 system-ui;cursor:pointer">✕</button>';
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
    /* Stil «Rotverlauf + Milchglas» für alle Tools: Verlauf von etwas dunklerer Akzentfarbe zur Akzentfarbe, Karten halbdurchsichtig */
    ':root{--bar0:color-mix(in srgb,var(--accent,#ff4d64) 82%,#000);--rgrad:linear-gradient(90deg,var(--bar0),var(--accent,#ff4d64) 70%);--glass:rgba(255,255,255,.045);--glass-line:rgba(255,255,255,.09)}' +
    ':root[data-theme="light"]{--bar0:color-mix(in srgb,var(--accent,#d02843) 85%,#000);--glass:rgba(255,255,255,.62);--glass-line:rgba(28,28,32,.09)}' +
    'body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(55% 35% at 0% 0%,color-mix(in srgb,var(--accent,#ff4d64) 13%,transparent),transparent 70%),radial-gradient(45% 30% at 100% 35%,color-mix(in srgb,var(--accent,#ff4d64) 7%,transparent),transparent 70%),radial-gradient(60% 35% at 40% 100%,color-mix(in srgb,var(--accent,#ff4d64) 8%,transparent),transparent 70%)}' +
    '.card,.step,.panel,.take,.tw{background-color:var(--glass)!important;-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);border-color:var(--glass-line)!important}' +
    'h1 .acc,h1 em,.kw{background-image:var(--rgrad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}' +
    '.dbz-g{background-image:var(--rgrad)!important}.dbz-g:hover{filter:brightness(1.07)}' +
    /* Einheitliche Ablagefelder (Trair qua … / u cliccar per tscherner) in allen Tools */
    '.drop,#drop,#de-drop{border:2px dashed color-mix(in srgb,var(--muted,#9a9aa2) 45%,transparent)!important;border-radius:14px!important;padding:28px 16px!important;text-align:center!important;cursor:pointer;background-color:var(--glass)!important;color:var(--muted,#9a9aa2)!important;font-size:.85rem!important;line-height:1.45;transition:border-color .15s,background-color .15s}' +
    '.drop>b,.drop>strong,#drop>b,#de-drop>b{display:block;font-size:1rem;font-weight:600;color:var(--text,#ececef);margin:0 0 3px}' +
    '.drop>small,.drop>span,#drop>small,#de-drop>small{display:block;margin:0;color:var(--muted,#9a9aa2);font-size:.8rem}' +
    '.drop:hover,.drop.over,.drop.drag,#drop:hover,#drop.over,#drop.drag,#de-drop:hover,#de-drop.over{border-color:var(--accent,#ff4d64)!important;background-color:color-mix(in srgb,var(--accent,#ff4d64) 7%,transparent)!important}' +
    /* Download-Knöpfe: einheitlich mit ↓ */
    '.dbz-dl::before{content:"↓";display:inline-block;margin-right:.4em;font-weight:700}' +
    '.seg button[aria-pressed="true"],.ratio-seg button.active,.ptab[aria-selected="true"],.tab[aria-selected="true"],.tabs button[aria-selected="true"],.ctog button[aria-pressed="true"],.wseg button[aria-pressed="true"],.tool[aria-pressed="true"],.seg input:checked+label{background-image:var(--rgrad)!important}' +
    '@media print{.themebtn{display:none}}';
  var s = d.createElement('style'); s.id = 'dbz-theme-css'; s.textContent = css; (d.head || r).appendChild(s);
  // Flächen in Akzentfarbe (Knöpfe, Nummern) bekommen den Rotverlauf: per Klasse dbz-g, weil CSS die Farbe nicht abfragen kann
  var acc = '', painting = 0;
  // ein einziges, dauerhaftes Mess-Element (sonst löst jedes Messen den MutationObserver erneut aus)
  var probe;
  function accent() { if (!probe) { probe = d.createElement('i'); probe.setAttribute('aria-hidden', 'true'); probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;color:var(--accent)'; d.body.appendChild(probe); } return getComputedStyle(probe).color; }
  function grad() {
    painting = 0; if (!d.body) return; acc = accent();
    d.querySelectorAll('button,a[class],.num,.btn,[class*="btn"]').forEach(function (el) {
      if (el.classList.contains('themebtn')) return;
      // nur ändern, wenn nötig – sonst entstünde über den Observer eine Endlosschleife
      var g = getComputedStyle(el).backgroundColor === acc; if (g !== el.classList.contains('dbz-g')) el.classList.toggle('dbz-g', g);
      // Knöpfe «Telechargiar …» bekommen einheitlich ein ↓
      var dl = /^Telechargiar\b/.test((el.textContent || '').trim()); if (dl !== el.classList.contains('dbz-dl')) el.classList.toggle('dbz-dl', dl);
    });
  }
  window.dbzGrad = function () { if (!painting) painting = requestAnimationFrame(grad); };
  var startGrad = function () { grad(); new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) if (ms[i].type === 'childList' || ms[i].attributeName !== 'style') { dbzGrad(); return; } })
    .observe(d.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-pressed', 'aria-selected'] }); };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', startGrad); else startGrad();
  window.addEventListener('dbz-theme', function () { dbzGrad(); });

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

// Kurze Hilfe pro Tool: «?» neben dem Titel, Text klappt darunter auf. Texte hier zentral pflegen (Rumantsch Grischun).
// Schlüssel = Pfad der Seite; Aliase zeigen auf denselben Text. Seiten mit eigener Hilfe (#help) bleiben unverändert.
(function () {
  var HELP = {
    '/rtr-picture': ['Sin rtr.ch: clic dretg sin il maletg → «Copiar l’adressa dal maletg», u simplamain copiar il link da l’artitgel.', 'Integrar il link qua – il tool tschertga sez la versiun la pli gronda e la mussa en la prevista.', 'Tip: En il tab «Plirs maletgs» pos ti integrar in link d’artitgel u plirs links ina giada e chargiar giu tut ils maletgs.'],
    '/visual': ['Tscherner il visual: Magazin, Il di u #mument (format aut 1080 × 1350).', 'Trair la foto en la surfatscha, integrar cun Ctrl/Cmd+V u inditgar in link da maletg RTR.', 'Spustar e zoomar la foto, lura «Telechargiar il maletg». Tip: La foto emplenescha adina l’entira surfatscha.'],
    '/maletgs': ['«Clerezza + colurs» curregia clerezza e colurs, «Rotar + drizzar» drizza l’orizont e la perspectiva.', '«Collascha» unescha 2 u 3 maletgs en 16:9 u 1:1, «Layers» metta overlays e logos sur il maletg.', 'Tip: Ils maletgs chargiads restan en il «Parcadi» e stattan a disposiziun en tut ils tabs.'],
    '/Resizer2000': ['Trair in u plirs maletgs en la surfatscha u tutgar per tscherner.', 'Tscherner format e qualitad – ils maletgs vegnan reducids sin 2000 px a la vart lunga e telechargiads.', 'Tip: Maletgs che èn gia pli pitschens na vegnan betg engrondids.'],
    '/Plan': ['Chargiar il plan da lavur actual (PDF) – dal computer u cun il bookmarklet directamain da SharePoint.', 'Tscherner la redacziun e la perioda; opziunalmain marcar ina persuna per vesair ses servetschs.', 'Il plan na vegn betg memorisà – chargiar mintga giada la versiun actuala.'],
    '/artitgel': ['Integrar in link dal CMS, in link URN u l’URL d’in artitgel publitgà.', 'Il tool mussa ils auters links – era per artitgels che n’èn anc betg publitgads.', 'Tip: Uschia pos ti trametter links che funcziunan per il newsletter u social media gia avant la publicaziun.'],
    '/audio-recorder': ['Tscherner la funtauna: in tab dal browser, il tun dal sistem u in apparat audio, lura «Colliar la funtauna».', 'Mono u stereo tscherner e cumenzar la registraziun – ella vegn arcunada sco WAV (48 kHz, 16 bit).', 'Tip: Tar in tab dal browser en il dialog activar «Tab-Audio teilen» e betg serrar il tab durant la registraziun.'],
    '/srt2ttml': ['Trair in file SRT en la surfatscha u tutgar per tscherner.', 'Il tool convertescha il file en TTML tenor il model da RTR (sco en Subtitle Edit) e ta dat el per telechargiar.'],
    '/studio': ['«Spustar temps» sposta tut ils suttitels per in temp fix (uras, minutas, secundas u maletgs).', '«Cumparegliar» mussa differenzas tranter dus files (A e B): temps, suttitels che mancan.', '«RM → DE»: «Copiar & avrir ALAS», translatar, copiar il resultat e «Integrar dal clipboard» – il tool reparta il text automaticamain sin ils timecodes.'],
    '/data': ['Integrar il link d’ina grafica Datawrapper u d’in artitgel RTR cun grafica.', 'Tscherner format, resoluziun e tge che duai esser visibel (titel, descripziun, byline, funtauna).', 'Lura telechargiar sco PNG – per Magazin e Il di è 16:9 il format adattà.'],
    '/votgr': ['Tscherner la votaziun – las chartas da las vischnancas vegnan chargiadas directamain dad abstimmungen.gr.ch.', 'Telechargiar sco PNG en 4K (16:9). Era per votaziuns futuras, senza tschertgar links.']
  };
  var ALIAS = { '/mument': '/visual', '/layers': '/maletgs', '/collascha': '/maletgs', '/colurs': '/maletgs', '/rotar': '/maletgs', '/spustar': '/studio', '/cumparegliar': '/studio', '/subs': '/studio' };
  function mount() {
    var d = document, k = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    k = ALIAS[k] || k; var t = HELP[k], h1 = d.querySelector('h1');
    if (!t || !h1 || d.getElementById('help') || h1.querySelector('.dbz-help')) return;
    var b = d.createElement('button'); b.type = 'button'; b.className = 'dbz-help'; b.textContent = '?';
    b.setAttribute('aria-expanded', 'false'); b.title = 'Co funcziuna quai?'; b.setAttribute('aria-label', 'Co funcziuna quai?');
    var box = d.createElement('div'); box.className = 'dbz-helpbox'; box.hidden = true; box.id = 'dbz-helpbox'; b.setAttribute('aria-controls', box.id);
    box.innerHTML = '<ol>' + t.filter(function (x) { return x.indexOf('Tip:') !== 0; }).map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
      t.filter(function (x) { return x.indexOf('Tip:') === 0; }).map(function (x) { return '<p><b>Tip:</b>' + x.slice(4) + '</p>'; }).join('');
    // Tipps können auch am Ende eines Schritts stehen («… Tip: …»): abtrennen
    box.querySelectorAll('li').forEach(function (li) { var i = li.innerHTML.indexOf(' Tip: '); if (i > 0) { var p = d.createElement('p'); p.innerHTML = '<b>Tip:</b> ' + li.innerHTML.slice(i + 6); li.innerHTML = li.innerHTML.slice(0, i); box.appendChild(p); } });
    h1.appendChild(b);
    var after = h1.nextElementSibling && h1.nextElementSibling.tagName === 'P' ? h1.nextElementSibling : h1;
    after.insertAdjacentElement('afterend', box);
    b.addEventListener('click', function () { box.hidden = !box.hidden; b.setAttribute('aria-expanded', !box.hidden); });
  }
  var css = '.dbz-help{display:inline-grid;place-items:center;width:24px;height:24px;margin-left:10px;padding:0;border-radius:50%;border:1px solid var(--line,var(--border,#2f2f34));background:transparent!important;color:var(--muted,#9a9aa2);font:600 13px/1 system-ui,sans-serif;vertical-align:5px;cursor:pointer;-webkit-text-fill-color:currentColor}' +
    '.dbz-help:hover,.dbz-help[aria-expanded="true"]{color:var(--text,#ececef);border-color:var(--accent,#ff4d64)}' +
    '.dbz-helpbox{margin:4px 0 18px;padding:12px 16px;border:1px solid color-mix(in srgb,var(--accent,#ff4d64) 40%,transparent);border-radius:12px;background:var(--glass,rgba(255,255,255,.045));-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);font-size:.88rem;line-height:1.5;color:var(--text,#ececef);max-width:640px}' +
    '.dbz-helpbox[hidden]{display:none}.dbz-helpbox ol{margin:0;padding-left:1.2em}.dbz-helpbox li{margin:2px 0}.dbz-helpbox p{margin:8px 0 0;color:var(--muted,#9a9aa2)}.dbz-helpbox b{color:var(--text,#ececef)}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

// Anonyme Zufalls-Kennung pro Browser (nur zum Zählen verschiedener Besucher; gilt für alle Seiten gemeinsam)
window.dbzCid = function () {
  var c = ''; try {
    c = localStorage.getItem('dbz-cid') || '';
    if (!/^[A-Za-z0-9-]{8,40}$/.test(c)) { c = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('dbz-cid', c); }
  } catch (e) { c = ''; }
  return c;
};
