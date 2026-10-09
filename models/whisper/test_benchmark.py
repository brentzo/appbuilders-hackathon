import importlib.util
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT = Path(__file__).with_name("benchmark.py")
SPEC = importlib.util.spec_from_file_location("benchmark", SCRIPT)
benchmark = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def test_endpoint_must_be_local_to_keep_audio_on_device(self):
        benchmark.validate_endpoint("http://127.0.0.1:8080/inference")
        benchmark.validate_endpoint("http://[::1]:8080/inference")
        with self.assertRaisesRegex(ValueError, "audio must stay on this device"):
            benchmark.validate_endpoint("https://example.com/transcribe")

    def test_word_error_rate_normalizes_case_and_punctuation(self):
        self.assertEqual(benchmark.word_error_rate("Hello, Yumi!", "hello Yumi"), (0, 2))
        self.assertEqual(benchmark.word_error_rate("open Spotify", "open Safari"), (1, 2))

    def test_cli_posts_audio_and_records_transcript_latency_and_wer(self):
        received = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received["path"] = self.path
                received["body"] = self.rfile.read(int(self.headers["Content-Length"]))
                body = json.dumps({"text": "pakihanap yung resume"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                (root / "clip.wav").write_bytes(b"FAKE_AUDIO")
                manifest = root / "transcripts.jsonl"
                manifest.write_text(
                    json.dumps({
                        "id": "clip-01",
                        "group": "taglish",
                        "audio": "clip.wav",
                        "reference": "Pakihanap yung resume",
                    }) + "\n",
                    encoding="utf-8",
                )
                output = root / "results.json"
                result = subprocess.run(
                    [
                        sys.executable, str(SCRIPT),
                        "--runtime", "whisperkit",
                        "--model", "small",
                        "--endpoint", f"http://127.0.0.1:{server.server_port}/v1/audio/transcriptions",
                        "--manifest", str(manifest),
                        "--audio-dir", str(root),
                        "--output", str(output),
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                saved = json.loads(output.read_text(encoding="utf-8"))
                row = saved["samples"][0]
                self.assertEqual(received["path"], "/v1/audio/transcriptions")
                self.assertIn(b"FAKE_AUDIO", received["body"])
                self.assertEqual(row["transcript"], "pakihanap yung resume")
                self.assertGreaterEqual(row["latency_ms"], 0)
                self.assertEqual(row["word_errors"], 0)
                self.assertEqual(saved["summary"]["taglish"]["wer"], 0)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
