// «Avrir en …»: Ein Tool öffnet ein anderes mit einem Bild, z. B. /visual?img=<URL>&from=picture
// Das Ziel-Tool lädt das Bild über seine eigene Link-Funktion (loadFromUrl) bzw. als Datei (Resizer: handle).
(() => {
  const q = new URLSearchParams(location.search), img = q.get('img');
  if (!img || !/^https?:\/\/([a-z0-9-]+\.)*(rtr\.ch|srf\.ch|srgssr\.ch)\//i.test(img)) return;
  const FROM = { picture: 'RTR Picture-downloader', layers: 'Elavurar maletgs', maletgs: 'Colurar, rotar e cumbinar' };
  const from = FROM[q.get('from')] || '';
  history.replaceState(null, '', location.pathname); // Parameter nicht stehen lassen (Neuladen = leeres Tool)
  const note = (txt, warn) => {
    let n = document.getElementById('dbz-handoff');
    if (!n) {
      n = document.createElement('div'); n.id = 'dbz-handoff';
      n.style.cssText = 'margin:0 0 14px;padding:9px 12px;border-radius:10px;font-size:.85rem;font-weight:600';
      const h = document.querySelector('h1'), sub = h && h.nextElementSibling;
      (sub && sub.tagName === 'P' ? sub : h || document.body.firstElementChild).after(n);
    }
    n.style.background = warn ? 'rgba(240,180,84,.12)' : 'rgba(95,210,154,.12)';
    n.style.border = '1px solid ' + (warn ? 'rgba(240,180,84,.45)' : 'rgba(95,210,154,.45)');
    n.style.color = warn ? '#d9962c' : '#2fae72';
    n.textContent = txt;
  };
  const ok = () => note('✓ Maletg surpiglià' + (from ? ' dal ' + from : ''));
  window.addEventListener('DOMContentLoaded', async () => {
    note('Chargel il maletg …');
    try {
      const r = await fetch(img, { mode: 'cors', cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      let b = await r.blob(); if (!b.type.startsWith('image/')) b = new Blob([b], { type: 'image/jpeg' });
      const name = decodeURIComponent(img.split(/[?#]/)[0].split('/').pop() || 'maletg');
      const file = new File([b], name, { type: b.type });
      if (typeof addFile === 'function') await addFile(file, name);        // Elavurar maletgs
      else if (typeof load === 'function') await load(file, name);         // Magazin / Il di, #mument
      else if (typeof handle === 'function') await handle([file]);         // Resizer 2000
      else throw new Error('no loader');
      ok();
    } catch (e) {
      note("Il maletg n'ha betg pudì vegnir surpiglià. Al telechargiar e trair qua.", true);
    }
  });
})();
