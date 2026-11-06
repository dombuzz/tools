#!/usr/bin/env python3
"""Lokaler Übersetzungs-Server für das Subtitle Studio (Colab) /lab/UTstudio-colab (Box «Optional: translatar localmain», RM <-> DE) – experimentell.

Modell: ZurichNLP/romansh-nllb-1.3b-ct2 (Hugging Face, Lizenz CC-BY-NC-4.0 – nicht kommerziell!)
Datenschutz: Der Server lauscht NUR auf 127.0.0.1 (dein eigener Rechner). Texte werden weder
gespeichert noch geloggt und verlassen den Rechner nicht. Nur beim ersten Start wird das Modell
(ca. 1.3 GB) von huggingface.co heruntergeladen; danach läuft alles offline.

Start:
    pip install ctranslate2 transformers sentencepiece huggingface_hub
    python3 studio-test-server.py            # echtes Modell
    python3 studio-test-server.py --demo     # ohne Modell, gibt nur "[DEMO] ..." zurück (für Funktionstest)
    Optionen: --token GEHEIM (Zugangsschlüssel, Header X-Token), --device auto|cpu|cuda, --port 8787
Dann https://tools.dombuzz.ch/lab/UTstudio-colab öffnen, in «RM ⇄ DE» Schritt 2 die Box «Optional: translatar localmain» aufklappen.

Schnittstelle:
    GET  /health      -> {"ok": true, "model": "..."}
    POST /translate   {"src": "rm-rumgr", "tgt": "deu_Latn", "texts": ["...", ...]} -> {"translations": [...]}
Sprachcodes: deu_Latn, rm-rumgr, rm-sursilv, rm-sutsilv, rm-surmiran, rm-puter, rm-vallader
"""
import json, sys, argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = "ZurichNLP/romansh-nllb-1.3b-ct2"
CODES = {"deu_Latn", "rm-rumgr", "rm-sursilv", "rm-sutsilv", "rm-surmiran", "rm-puter", "rm-vallader"}
ORIGINS = ("https://tools.dombuzz.ch", "http://localhost", "http://127.0.0.1")

ap = argparse.ArgumentParser()
ap.add_argument("--demo", action="store_true", help="ohne Modell starten (Platzhalter-Übersetzung)")
ap.add_argument("--port", type=int, default=8787)
ap.add_argument("--threads", type=int, default=0, help="CPU-Threads (0 = automatisch)")
ap.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto", help="auto = GPU wenn vorhanden, sonst CPU")
ap.add_argument("--token", default="", help="Zugangsschlüssel: Anfragen müssen den Header X-Token mitschicken (für Fernzugriff, z. B. Colab)")
ap.add_argument("--host", default="127.0.0.1", help="Adresse, auf der gelauscht wird")
ARGS = ap.parse_args()

if ARGS.demo:
    def translate(src, tgt, texts):
        return [f"[DEMO {src}→{tgt}] {t}" for t in texts]
else:
    import ctranslate2
    from huggingface_hub import snapshot_download
    from transformers import NllbTokenizer
    print("Lade Modell (beim ersten Mal Download ca. 1.3 GB) …", flush=True)
    path = snapshot_download(MODEL_ID)
    tok = NllbTokenizer.from_pretrained(path)
    def _preload_cublas():  # Colab hat neuere CUDA-Version: cuBLAS 12 aus dem pip-Paket nachladen (falls installiert)
        import ctypes, glob, site
        for sp in site.getsitepackages():
            for pat in ("nvidia/cublas/lib/libcublasLt.so.12*", "nvidia/cublas/lib/libcublas.so.12*"):
                for f in glob.glob(f"{sp}/{pat}"):
                    try: ctypes.CDLL(f, mode=ctypes.RTLD_GLOBAL)
                    except OSError: pass
    DEVICE = ARGS.device
    if DEVICE == "auto":
        DEVICE = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    if DEVICE == "cuda": _preload_cublas()
    tr = ctranslate2.Translator(path, device=DEVICE, inter_threads=1, intra_threads=ARGS.threads)

    def translate(src, tgt, texts):
        tok.src_lang = src
        batch = [tok.convert_ids_to_tokens(tok.encode(t)) for t in texts]
        res = tr.translate_batch(batch, target_prefix=[[tgt]] * len(batch), beam_size=4, max_decoding_length=256)
        return [tok.decode(tok.convert_tokens_to_ids(r.hypotheses[0][1:]), skip_special_tokens=True) for r in res]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # keine Zugriffs-Logs (enthalten sonst nichts Inhaltliches, aber sicher ist sicher)
        pass

    def _cors(self):
        o = self.headers.get("Origin", "")
        if o.startswith(ORIGINS):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Token")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": "DEMO" if ARGS.demo else MODEL_ID})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/translate":
            return self._json(404, {"error": "not found"})
        if not self.headers.get("Origin", "").startswith(ORIGINS):
            return self._json(403, {"error": "origin not allowed"})
        if ARGS.token and self.headers.get("X-Token", "") != ARGS.token:
            return self._json(401, {"error": "token"})
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            src, tgt, texts = d["src"], d["tgt"], d["texts"]
            assert src in CODES and tgt in CODES and src != tgt
            assert isinstance(texts, list) and len(texts) <= 64 and all(isinstance(t, str) and len(t) < 2000 for t in texts)
        except Exception:
            return self._json(400, {"error": "bad request"})
        try:
            self._json(200, {"translations": translate(src, tgt, texts)})
        except Exception as e:
            self._json(500, {"error": type(e).__name__})


if not ARGS.demo and DEVICE == "cuda":  # GPU-Test; bei Fehler auf CPU wechseln
    try: translate("deu_Latn", "rm-rumgr", ["Test."])
    except Exception as e:
        print("GPU nicht nutzbar, wechsle auf CPU:", str(e)[:100], flush=True)
        DEVICE = "cpu"; tr = ctranslate2.Translator(path, device="cpu", inter_threads=1, intra_threads=ARGS.threads)

if __name__ == "__main__":
    srv = ThreadingHTTPServer((ARGS.host, ARGS.port), H)
    print(f"Bereit auf http://{ARGS.host}:{ARGS.port}  ({'DEMO' if ARGS.demo else 'Modell geladen'}). Beenden mit Ctrl+C.", flush=True)
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
