/* HEIC/HEIF → PNG für alle Bild-Tools (Maletgs, Social …).
   Einbinden mit <script src="/heic.js"></script> (nicht defer nötig).
   Funktioniert ohne Änderung an den Tools: Wenn ein Bild-Eingabefeld oder eine Ablagefläche HEIC-Dateien bekommt,
   werden sie zuerst in PNG umgewandelt, erst dann sehen die Tools die Dateien. Die Umwandlung läuft ganz im Browser. */
(() => {
  if (window.dbzHeic) return;
  const LIB = '/vendor/heic/heic2any.min.js';
  const isHeic = f => !!f && (/^image\/(heic|heif)(-sequence)?$/i.test(f.type || '') || /\.(heic|heif|hif)$/i.test(f.name || ''));

  let libP = null;
  const lib = () => libP || (libP = new Promise((ok, no) => {
    if (window.heic2any) return ok(window.heic2any);
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = () => window.heic2any ? ok(window.heic2any) : no(new Error('heic2any fehlt'));
    s.onerror = () => { libP = null; no(new Error('heic2any konnte nicht geladen werden')); };
    document.head.appendChild(s);
  }));

  /* Hinweis unten links */
  let toast, toastT;
  function say(text, err, ms) {
    if (!toast) {
      toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;max-width:min(360px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;background:#1c1c1f;border:1px solid #333;color:#eee;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none';
      document.body.appendChild(toast);
    }
    clearTimeout(toastT);
    toast.textContent = text;
    toast.style.borderColor = err ? '#ff4d64' : '#333';
    toast.style.display = 'block';
    if (ms) toastT = setTimeout(() => { toast.style.display = 'none'; }, ms);
  }

  async function toPng(file) {
    const h = await lib();
    let out = await h({ blob: file, toType: 'image/png' });
    if (Array.isArray(out)) out = out[0];            // Serien-HEIC: erstes Bild
    const name = (file.name || 'maletg').replace(/\.(heic|heif|hif)$/i, '') + '.png';
    return new File([out], name, { type: 'image/png', lastModified: file.lastModified || Date.now() });
  }

  /* Dateiliste → Dateiliste ohne HEIC (nacheinander, damit der Speicher nicht überläuft) */
  async function convert(files) {
    const list = [...files], n = list.filter(isHeic).length;
    if (!n) return list;
    const out = []; let k = 0, bad = 0;
    for (const f of list) {
      if (!isHeic(f)) { out.push(f); continue; }
      say(n > 1 ? `HEIC vegn convertì … (${++k}/${n})` : 'HEIC vegn convertì …');
      try { out.push(await toPng(f)); }
      catch (e) { bad++; console.warn('HEIC-Umwandlung fehlgeschlagen:', f.name, e); }
    }
    if (bad) say(bad === n ? 'Il maletg HEIC n’ha betg pudì vegnir convertì.' : `${bad} da ${n} maletgs HEIC n’han betg pudì vegnir convertids.`, true, 6000);
    else say(n > 1 ? `${n} maletgs HEIC convertids en PNG.` : 'HEIC convertì en PNG.', false, 2500);
    return out;
  }

  const asList = fs => { const dt = new DataTransfer(); fs.forEach(f => dt.items.add(f)); return dt; };
  let passing = false;     // true, solange wir selbst ein Ereignis nachliefern

  /* Dateiauswahl: capture-Phase, damit wir vor den Handlern der Tools drankommen */
  window.addEventListener('change', e => {
    const t = e.target;
    if (passing || !t || t.tagName !== 'INPUT' || t.type !== 'file' || !t.files || ![...t.files].some(isHeic)) return;
    e.stopImmediatePropagation();
    convert(t.files).then(fs => {
      if (!fs.length) { t.value = ''; return; }
      try { t.files = asList(fs).files; } catch (err) { return; }
      passing = true;
      try { t.dispatchEvent(new Event('change', { bubbles: true })); } finally { passing = false; }
    });
  }, true);

  /* Drag & Drop */
  window.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (passing || !dt || !dt.files || ![...dt.files].some(isHeic)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const target = e.target, init = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey };
    convert(dt.files).then(fs => {
      if (!fs.length) return;
      let ev;
      try { ev = new DragEvent('drop', Object.assign(init, { dataTransfer: asList(fs) })); }
      catch (err) { return; }
      passing = true;
      try { target.dispatchEvent(ev); } finally { passing = false; }
    });
  }, true);

  window.dbzHeic = { isHeic, convert, toPng };
})();
