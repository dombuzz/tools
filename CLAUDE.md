# tools.dombuzz.ch – Hinweise für Claude und Mitarbeitende

Sammlung kleiner Web-Tools für die RTR-Redaktion (Rumantsch). Reines HTML/CSS/JS ohne Build-Schritt. Besitzer: Dominik Hardegger.

## Veröffentlichung
- GitHub Pages aus `main` (Domain in `CNAME`). Ein Push auf `main` ist sofort live, es gibt keinen Staging-Zweig.
- Der Cloudflare Worker (`worker/index.js`, Konfiguration `wrangler.jsonc`, Datenbank D1 «dombuzz-likes») wird von Cloudflare bei jedem Push auf `main` automatisch veröffentlicht. Kein manuelles Deploy nötig.
- Vor dem Push `git fetch` und rebase, `main` bewegt sich auch durch andere Sessions.
- Commit-Nachrichten kurz und auf Deutsch.

## Sprache
- Oberflächentexte, Titel, Fehlermeldungen: Rumantsch Grischun (Beispiele: «Copiar», «Telechargiar», «Tscherner»). Surselvisch nur dort, wo ein Tool ausdrücklich dafür gebaut ist (z. B. Radio «Il di»).
- Code-Kommentare und Commit-Nachrichten: Deutsch.
- Schreibweisen aus bestehenden Seiten übernehmen, nicht «korrigieren».

## Gemeinsame Dateien (wirken auf fast jede Seite)
- `theme.js`: Hell/Dunkel, Farbstärke, Zahnrad-Menü, Shader-Fächer, Testmodus (`?test`), Milchglas-Regeln für Boxen, Felder und Zellen.
- `shader.js`: WebGL-Hintergründe. Auswahl pro Seite über `<body data-shader-set="soA,soT,labA,soK">`. Wahl in `localStorage` unter `dbz-bg`; `rnd` = Zufallsmodus (pro Aufruf ein anderer Hintergrund aus dem Set, nie «off», mit zufälligem Zeit-Startwert).
- `motion.js`: Animationen, Hover-Effekte.
- `like.js`: Likes, Seitenaufrufe, Nutzung, Frage nach dem ersten Erfolg (Download, Kopie oder Event `dbz-success`). Teil-Tools melden sich über `window.dbzUseTool`.
- `sw.js`: Offline-Cache. **Bei jeder Änderung an einer gemeinsamen Datei die Version `dbz-vN` hochzählen**, sonst sehen Nutzer:innen alte Dateien.
- Jede Änderung an diesen Dateien kann viele Seiten verändern: danach den Smoke-Test laufen lassen.

## Gestaltung
- Neue Boxen müssen zum Milchglas passen: Klasse in der Glas-Liste von `theme.js` ergänzen statt auf der Seite eine volle Farbe (`background:var(--card)`) zu setzen.
- Mit aktivem Shader trägt `<html>` die Klasse `dbz-sh`. Felder und grau hinterlegte Schaltflächen sind dann halbdurchsichtig (Regeln in `theme.js`).
- Farben nur über die CSS-Variablen (`--card`, `--mono`, `--accent` …), damit Hell und Dunkel funktionieren.
- Akzentfarbe ist das Rot/Koralle der Seite, rote Schalter nie mit Transparenz überschreiben.

## Statistik und Kennungen
- Tool-Kennung kommt aus dem Pfad. Social-Tools: `social-<id>`. Namen und Gruppen stehen im Worker (`NAMES`, `GROUP`). Neue Tools dort eintragen, sonst erscheinen sie unbenannt im Dashboard.
- Das Dashboard (`dashboard.html`) liest `/stats` vom Worker. Neue Messwerte brauchen Anpassungen in beiden Dateien.
- Testmodus (`?test`) schickt nichts an den Worker.

## Weiterleitungen
- Kleine Stub-Seiten (unter 1,5 KB, mit `location.replace`) sind alte Adressen, z. B. `layers.html`, `studio.html`, `stats.html`. Nicht löschen, ohne zu wissen, dass niemand mehr alte Lesezeichen nutzt.

## Änderungsübersicht (`versiuns.html`)
- Grössere neue Features bekommen einen Eintrag (neueste oben, `<li><time datetime="…">`, Text auf Rumantsch Grischun). Kleine Änderungen (Abstände, Verschachtelungen, Kürzel) nicht.
- Erreichbar über die Versionsnummer unten auf der Startseite, nicht über das Dropdown.

## Test
- `python3 tests/smoke.py` lädt alle Seiten im Headless-Chrome und meldet JS-Fehler, 404er, leere Seiten und kaputte Weiterleitungen. Varianten: `--shader`, `--light`, `--only <pfad>`.
- Lokal ohne Playwright-Chromium: `CHROME_PATH=/usr/bin/google-chrome python3 tests/smoke.py`.
- Läuft auch als GitHub Action (`.github/workflows/smoke.yml`). Bewusst akzeptierte Meldungen: `tests/smoke-ignore.txt`.
- Optische Fehler findet der Test nicht. Dafür die Screenshots (`--shots ordner`) ansehen.

## Sonstiges
- Die Social-Tools unter `social/` entstehen aus einem Generator, der nicht im Repo liegt. Änderungen am gemeinsamen Teil müssen in allen Einzeldateien nachgezogen werden.
- Grosse Dateien (`lab/idioms.html` ca. 4,8 MB, `visual.html`, `maletgs.html`) nicht ohne Grund aufblähen.
