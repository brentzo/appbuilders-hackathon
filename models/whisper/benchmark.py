#!/usr/bin/env python3
"""Benchmark one preloaded Whisper server against a JSONL transcript manifest."""

import argparse
import ipaddress
import json
import mimetypes
import statistics
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit


def words(text):
    normalized = []
    for char in unicodedata.normalize("NFKC", text).casefold():
        normalized.append(char if unicodedata.category(char)[0] in {"L", "N"} else " ")
    return "".join(normalized).split()


def word_error_rate(reference, hypothesis):
    expected, actual = words(reference), words(hypothesis)
    previous = list(range(len(actual) + 1))
    for i, left in enumerate(expected, 1):
        current = [i]
        for j, right in enumerate(actual, 1):
            current.append(min(
                current[-1] + 1,
                previous[j] + 1,
                previous[j - 1] + (left != right),
            ))
        previous = current
    return previous[-1], len(expected)


def validate_endpoint(endpoint):
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("endpoint must be an HTTP URL on this device")
    host = parsed.hostname.casefold()
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host == "localhost"
    if not local:
        raise ValueError("endpoint must use localhost; audio must stay on this device")


def load_manifest(path, audio_dir):
    entries = []
    seen = set()
    root = Path(audio_dir).resolve()
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"manifest line {line_number}: invalid JSON: {exc.msg}") from exc
        if not isinstance(item, dict):
            raise ValueError(f"manifest line {line_number}: expected an object")
        missing = {"id", "group", "audio", "reference"} - item.keys()
        if missing:
            raise ValueError(f"manifest line {line_number}: missing {', '.join(sorted(missing))}")
        if not all(isinstance(item[key], str) and item[key].strip() for key in ("id", "group", "audio")):
            raise ValueError(f"manifest line {line_number}: id, group, and audio must be non-empty strings")
        if not isinstance(item["reference"], str) or not item["reference"].strip():
            raise ValueError(f"manifest line {line_number}: reference must be a non-empty string")
        if not words(item["reference"]):
            raise ValueError(f"manifest line {line_number}: reference must contain at least one word")
        if item["group"] not in {"taglish", "english"}:
            raise ValueError(f"manifest line {line_number}: group must be taglish or english")
        if item["id"] in seen:
            raise ValueError(f"manifest line {line_number}: duplicate id {item['id']!r}")
        seen.add(item["id"])
        audio = (root / item["audio"]).resolve()
        if not audio.is_relative_to(root):
            raise ValueError(f"manifest line {line_number}: audio path escapes the audio directory")
        if not audio.is_file():
            raise ValueError(f"manifest line {line_number}: audio file not found: {audio}")
        entries.append({**item, "audio_path": audio})
    if not entries:
        raise ValueError("manifest contains no samples")
    return entries


def transcribe(endpoint, runtime, model, language, audio_path, timeout):
    boundary = "yumi-" + uuid.uuid4().hex
    fields = {"model": model, "response_format": "json"}
    if language != "auto" or runtime == "whisper.cpp":
        fields["language"] = language
    if runtime == "whisper.cpp":
        fields["temperature"] = "0"
    chunks = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode("utf-8"),
            b"\r\n",
        ])
    audio = audio_path.read_bytes()
    filename = audio_path.name.replace('"', "")
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        audio,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ])
    request = urllib.request.Request(
        endpoint,
        data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"transcription request failed: {exc}") from exc
    elapsed_ms = (time.perf_counter() - started) * 1000
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise RuntimeError("server response must be JSON with a string 'text' field")
    return payload["text"].strip(), round(elapsed_ms, 1)


def summarize(samples):
    groups = defaultdict(list)
    for sample in samples:
        groups[sample["group"]].append(sample)
    summary = {}
    for name, rows in groups.items():
        errors = sum(row["word_errors"] for row in rows)
        reference_words = sum(row["reference_words"] for row in rows)
        summary[name] = {
            "samples": len(rows),
            "word_errors": errors,
            "reference_words": reference_words,
            "wer": errors / reference_words if reference_words else 0,
            "mean_latency_ms": round(statistics.mean(row["latency_ms"] for row in rows), 1),
            "median_latency_ms": round(statistics.median(row["latency_ms"] for row in rows), 1),
        }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", choices=("whisperkit", "whisper.cpp"), required=True)
    parser.add_argument("--model", required=True, help="Model label, recorded with the results")
    parser.add_argument("--endpoint", required=True, help="Local transcription HTTP endpoint")
    parser.add_argument("--manifest", required=True, help="JSONL rows: id, group, audio, reference")
    parser.add_argument("--audio-dir", required=True, help="External folder containing the consented recordings")
    parser.add_argument("--output", required=True, help="Output JSON report path")
    parser.add_argument("--language", default="auto", help="Whisper language hint (default: auto)")
    parser.add_argument("--timeout", type=float, default=1800, help="Per-clip timeout in seconds")
    args = parser.parse_args()

    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")
    validate_endpoint(args.endpoint)
    entries = load_manifest(args.manifest, args.audio_dir)
    samples = []
    for item in entries:
        transcript, latency_ms = transcribe(
            args.endpoint, args.runtime, args.model, args.language, item["audio_path"], args.timeout
        )
        errors, reference_words = word_error_rate(item["reference"], transcript)
        samples.append({
            "id": item["id"],
            "group": item["group"],
            "runtime": args.runtime,
            "model": args.model,
            "reference": item["reference"],
            "transcript": transcript,
            "latency_ms": latency_ms,
            "word_errors": errors,
            "reference_words": reference_words,
            "wer": errors / reference_words if reference_words else 0,
        })
        print(f"{item['id']}: WER={samples[-1]['wer']:.3f}, latency={latency_ms:.1f} ms")

    report = {"runtime": args.runtime, "model": args.model, "samples": samples, "summary": summarize(samples)}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
