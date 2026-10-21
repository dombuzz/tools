// Kleine Bewegungen für tools.dombuzz.ch – an einem Ort für alle Tools
// Einbinden: <script src="/motion.js" defer></script> direkt nach theme.js
// Ergänzt bestehende Seiten, ohne deren eigene Skripte zu ändern:
//  1. Kopieren: Haken und Farbwechsel am Knopf, sobald das Kopieren geklappt hat
//  2. Gleitende Auswahl: eine Pille gleitet zwischen Tabs und Umschaltern (.tabs, .seg, .ctog, .wseg, .ptabs)
//  3. Drop-Zone: hebt sich beim Darüberziehen leicht an und färbt sich ein
//  4. Aufklappbereiche (<details>): weiches Auf- und Zuklappen mit leichter Feder
// Wer am Gerät «Bewegung reduzieren» eingestellt hat, bekommt das Verhalten ohne Animation.
(function () {
  'use strict';
  var d = document, RM = matchMedia('(prefers-reduced-motion: reduce)');

  var css =
    /* 1 Kopieren */
    '.dbz-copied{transition:background .2s,color .2s,border-color .2s}' +
    '.dbz-copied:not(.link){background:var(--ok,#6fcf97)!important;border-color:var(--ok,#6fcf97)!important;color:var(--on-accent,#121214)!important}' +
    '.dbz-copied.link{color:var(--ok,#6fcf97)!important}' +
    '.dbz-ic::before{content:"";display:inline-block;width:.3em;height:.58em;border:solid currentColor;border-width:0 .15em .15em 0;margin:0 .6em .12em .15em;transform:rotate(45deg);animation:dbz-pop .45s cubic-bezier(.3,1.6,.5,1)}' +
    '@keyframes dbz-pop{from{transform:rotate(45deg) scale(0)}to{transform:rotate(45deg) scale(1)}}' +
    /* 2 Gleitende Auswahl: die Pille ist ein ::before des Containers, gesteuert über Variablen */
    '.dbz-slide{isolation:isolate}.dbz-rel{position:relative}' +
    '.dbz-slide::before{content:"";position:absolute;left:0;top:0;z-index:-1;box-sizing:border-box;pointer-events:none;' +
    'width:var(--dbz-w,0px);height:var(--dbz-h,0px);transform:translate(var(--dbz-x,0px),var(--dbz-y,0px));' +
    'background:var(--dbz-bg,transparent);border:var(--dbz-bd,0 none transparent);box-shadow:var(--dbz-sh,none);border-radius:var(--dbz-r,0);opacity:var(--dbz-o,0);' +
    'transition:transform .38s cubic-bezier(.3,1.15,.4,1),width .38s cubic-bezier(.3,1.15,.4,1),height .3s,opacity .2s}' +
    '.dbz-slide:not(.dbz-ready)::before{transition:none}' +
    '.dbz-slide>.dbz-sel.dbz-sel{background:transparent!important;border-color:transparent!important;box-shadow:none!important}' +
    /* 3 Drop-Zone */
    '.drop[role="button"],#drop[role="button"]{transition:border-color .2s,transform .25s cubic-bezier(.3,1.4,.5,1),box-shadow .2s}' +
    '.drop[role="button"].over,#drop[role="button"].over{transform:scale(1.015);box-shadow:inset 0 0 0 999px color-mix(in srgb,var(--accent,var(--acc,#ff4d64)) 9%,transparent)}';
  var st = d.createElement('style'); st.id = 'dbz-motion-css'; st.textContent = css; (d.head || d.documentElement).appendChild(st);

  /* ---------- 1 Kopieren ---------- */
  var lastBtn = null, lastT = 0, offT = 0;
  d.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button,[role="button"],a');
    if (b) { lastBtn = b; lastT = Date.now(); }
  }, true);
  function copied() {
    var b = lastBtn;
    if (!b || !b.isConnected || Date.now() - lastT > 3000) return;
    b.classList.add('dbz-copied');
    setTimeout(function () { if (!/✓/.test(b.textContent)) b.classList.add('dbz-ic'); }, 40);
    clearTimeout(offT);
    offT = setTimeout(function () { b.classList.remove('dbz-copied', 'dbz-ic'); }, 1700);
  }
  var cb = navigator.clipboard;
  if (cb && cb.writeText) {
    var write = cb.writeText.bind(cb);
    cb.writeText = function (t) { var p = write(t); p.then(copied, function () {}); return p; };
  }
  var exec = d.execCommand;
  if (exec) d.execCommand = function (c) {
    var r = exec.apply(d, arguments);
    if (r && String(c).toLowerCase() === 'copy') copied();
    return r;
  };

  /* ---------- 2 Gleitende Auswahl ---------- */
  var SEL = '.tabs,.ptabs,.ctog,.seg,.wseg,[role="tablist"]', slides = [];
  function selected(c) {
    var out = [];
    for (var i = 0; i < c.children.length; i++) {
      var el = c.children[i], p = el.previousElementSibling;
      if (el.matches('[aria-selected="true"],[aria-pressed="true"],[aria-checked="true"],.active')) out.push(el);
      else if (el.tagName === 'LABEL' && p && p.matches('input:checked')) out.push(el);
    }
    return out;
  }
  function opaque(el) {
    var m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
    if (!m) return false;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) > 0.1 : true;
  }
  function sync(c) {
    var sel = selected(c), s = c.style;
    for (var i = 0; i < c.children.length; i++) c.children[i].classList.remove('dbz-sel');
    if (sel.length !== 1 || !sel[0].offsetWidth) { s.setProperty('--dbz-o', '0'); c._mo.takeRecords(); return; }
    var b = sel[0], cs = getComputedStyle(b);
    s.setProperty('--dbz-bg', cs.backgroundColor);
    s.setProperty('--dbz-bd', cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor);
    s.setProperty('--dbz-sh', cs.boxShadow);
    s.setProperty('--dbz-r', cs.borderRadius);
    s.setProperty('--dbz-x', b.offsetLeft + 'px');
    s.setProperty('--dbz-y', b.offsetTop + 'px');
    s.setProperty('--dbz-w', b.offsetWidth + 'px');
    s.setProperty('--dbz-h', b.offsetHeight + 'px');
    s.setProperty('--dbz-o', '1');
    b.classList.add('dbz-sel');
    c._mo.takeRecords();
  }
  function enhance(c) {
    if (c._dbz || c.children.length < 2) return;
    var items = [].filter.call(c.children, function (k) { return k.tagName === 'BUTTON' || k.tagName === 'LABEL'; });
    if (items.length < 2) return;
    var sel = selected(c);
    // Sind die nicht gewählten Felder deckend gefüllt, würde die Pille darunter verschwinden: dann so lassen
    if (items.some(function (k) { return sel.indexOf(k) < 0 && opaque(k); })) { c._dbz = 1; return; }
    c._dbz = 2;
    c.classList.add('dbz-slide');
    if (getComputedStyle(c).position === 'static') c.classList.add('dbz-rel');
    var later = function () { requestAnimationFrame(function () { if (c.isConnected) sync(c); }); };
    c._mo = new MutationObserver(function () { sync(c); });
    c._mo.observe(c, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-checked', 'class'] });
    c.addEventListener('change', later);
    if (window.ResizeObserver) { c._ro = new ResizeObserver(later); c._ro.observe(c); }
    slides.push(c);
    sync(c);
    requestAnimationFrame(function () { requestAnimationFrame(function () { c.classList.add('dbz-ready'); }); });
  }
  function scan() {
    slides = slides.filter(function (c) {
      if (c.isConnected) return true;
      c._mo.disconnect(); if (c._ro) c._ro.disconnect();
      return false;
    });
    d.querySelectorAll(SEL).forEach(enhance);
  }
  function syncAll() { slides.forEach(function (c) { if (c.isConnected) sync(c); }); }
  scan();
  addEventListener('load', function () { scan(); syncAll(); });
  setTimeout(scan, 600);
  if (d.fonts && d.fonts.ready) d.fonts.ready.then(syncAll);
  addEventListener('resize', function () { requestAnimationFrame(syncAll); });
  addEventListener('dbz-theme', function () { requestAnimationFrame(syncAll); });
  // Seiten, die Tabs oder Umschalter neu aufbauen (z. B. Diagramm-Umschalter in der Statistik)
  var pend = 0;
  new MutationObserver(function () {
    if (pend) return;
    pend = setTimeout(function () { pend = 0; scan(); }, 250);
  }).observe(d.body || d.documentElement, { childList: true, subtree: true });

  /* ---------- 4 Aufklappbereiche mit Feder ---------- */
  function px(v) { return parseFloat(v) || 0; }
  function toggle(det, sum) {
    var busy = !!det._a, now = det.getBoundingClientRect().height;
    if (busy) { det._a.onfinish = null; det._a.cancel(); }
    var open = busy ? !det._op : !det.open, from = now, to;
    det.style.overflow = 'hidden'; det.style.boxSizing = 'border-box';
    if (open) { det.open = true; det.style.height = ''; to = det.getBoundingClientRect().height; }
    else {
      var cs = getComputedStyle(det);
      to = sum.getBoundingClientRect().bottom - det.getBoundingClientRect().top + px(cs.paddingBottom) + px(cs.borderBottomWidth);
    }
    det._op = open;
    var a = det._a = det.animate([{ height: from + 'px' }, { height: to + 'px' }], {
      duration: open ? 420 : 260,
      easing: open ? 'cubic-bezier(.3,1.2,.4,1)' : 'cubic-bezier(.4,0,.2,1)'
    });
    a.onfinish = function () {
      det._a = null; det.style.overflow = ''; det.style.boxSizing = '';
      if (!open) det.open = false;
    };
  }
  d.addEventListener('click', function (e) {
    if (RM.matches || e.defaultPrevented || !e.target.closest) return;
    var sum = e.target.closest('summary');
    if (!sum || !sum.parentNode || sum.parentNode.tagName !== 'DETAILS' || !sum.parentNode.animate) return;
    var inner = e.target.closest('input,button,a,select,textarea,label');
    if (inner && sum.contains(inner)) return;
    e.preventDefault();
    toggle(sum.parentNode, sum);
  });
})();
