// Für die Tab-Seiten von /social (social-profil, social-novitads, social-mument): sie werden von /social direkt eingebaut.
// Direkt geöffnet (Seite ist das Top-Dokument) verhalten sie sich wie ein normales Tool mit like.js.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('script'); s.src = '/like.js'; s.defer = true; document.body.appendChild(s);
  });
})();
