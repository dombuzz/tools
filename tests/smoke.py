#!/usr/bin/env python3
"""Smoke-Test für tools.dombuzz.ch: lädt jede Seite im Headless-Chrome und meldet
JavaScript-Fehler, fehlgeschlagene lokale Anfragen, leere Seiten und kaputte Weiterleitungen.

Lauf:  python3 tests/smoke.py [--shader] [--light] [--only teil-des-pfads] [--shots ordner]
Lokal ein vorhandenes Chrome nutzen:  CHROME_PATH=/usr/bin/google-chrome python3 tests/smoke.py
Bekannte, bewusst akzeptierte Meldungen: tests/smoke-ignore.txt (ein Teilstring pro Zeile).
"""
import argparse, functools, glob, http.server, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NET = re.compile(r'Failed to fetch|NetworkError|Load failed|net::ERR|Failed to load resource|fetch failed', re.I)

def pages():
    out = []
    for pat in ('*.html', 'social/*.html', 'lab/*.html'):
        out += sorted(glob.glob(os.path.join(ROOT, pat)))
    return [os.path.relpath(p, ROOT) for p in out]

def ignore_list():
    p = os.path.join(ROOT, 'tests', 'smoke-ignore.txt')
    return [l.strip() for l in open(p, encoding='utf-8') if l.strip() and not l.startswith('#')] if os.path.exists(p) else []

class Handler(http.server.SimpleHTTPRequestHandler):
    """Wie GitHub Pages: /maletgs liefert maletgs.html, /social/ liefert social/index.html."""
    def translate_path(self, path):
        f = super().translate_path(path)
        if not os.path.exists(f) and not os.path.splitext(f)[1] and os.path.exists(f + '.html'): return f + '.html'
        return f
    def log_message(self, *a, **k): pass

def serve():
    h = functools.partial(Handler, directory=ROOT)
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), h); srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shader', action='store_true', help='Shader-Hintergrund aktivieren (soT)')
    ap.add_argument('--light', action='store_true', help='helles Farbschema')
    ap.add_argument('--only', default='')
    ap.add_argument('--shots', default='')
    a = ap.parse_args()
    ign = ignore_list(); srv, port = serve(); base = f'http://127.0.0.1:{port}'
    fails = []; n = 0
    with sync_playwright() as p:
        kw = {'args': ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']}
        if os.environ.get('CHROME_PATH'): kw['executable_path'] = os.environ['CHROME_PATH']
        br = p.chromium.launch(**kw)
        ctx = br.new_context(viewport={'width': 1280, 'height': 800}, color_scheme='light' if a.light else 'dark')
        ctx.route(re.compile(r'^https?://(?!127\.0\.0\.1)'), lambda r: r.abort())  # nichts nach aussen
        init = []
        if a.shader: init.append("try{localStorage.setItem('dbz-bg','soT')}catch(e){}")
        if a.light: init.append("try{localStorage.setItem('dbz-theme','light')}catch(e){}")
        if init: ctx.add_init_script(';'.join(init))
        for rel in pages():
            if a.only and a.only not in rel: continue
            n += 1; errs = []; pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append('JS: ' + str(e)) if not NET.search(str(e)) else None)
            pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' and not NET.search(m.text) else None)
            pg.on('requestfailed', lambda r: errs.append('Anfrage: ' + r.url) if r.url.startswith(base) else None)
            pg.on('response', lambda r: errs.append(f'HTTP {r.status}: {r.url}') if r.url.startswith(base) and r.status >= 400 and not r.url.endswith(('favicon.ico',)) else None)
            try:
                url = f'{base}/{rel}'
                resp = pg.goto(url, wait_until='load', timeout=30000)
                pg.wait_for_timeout(900)
                stub = os.path.getsize(os.path.join(ROOT, rel)) < 1500
                if stub:
                    if pg.url.split('?')[0].split('#')[0].endswith(rel) and rel != '404.html': errs.append('Weiterleitung führt nirgends hin: ' + pg.url)
                    elif '404' in (pg.title() or ''): errs.append('Weiterleitung landet auf 404: ' + pg.url)
                elif rel != '404.html' and len((pg.inner_text('body') or '').strip()) < 20: errs.append('Seite ist leer')
                if a.shots:
                    os.makedirs(a.shots, exist_ok=True); pg.screenshot(path=os.path.join(a.shots, re.sub(r'[^A-Za-z0-9]+', '_', rel) + '.png'))
            except Exception as e:
                errs.append('Laden fehlgeschlagen: ' + str(e).splitlines()[0])
            errs = [e for e in errs if not any(i in e for i in ign)]
            if errs: fails.append((rel, sorted(set(errs))))
            pg.close()
        br.close()
    srv.shutdown()
    mode = ('Shader ' if a.shader else '') + ('hell' if a.light else 'dunkel')
    print(f'{n} Seiten geprüft ({mode}), {len(fails)} mit Problemen')
    for rel, es in fails:
        print(f'\n✗ {rel}')
        for e in es[:6]: print('   ', e[:220])
    sys.exit(1 if fails else 0)

if __name__ == '__main__': main()
