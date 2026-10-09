#!/usr/bin/env python3
"""Benchmark one preloaded Whisper server against a JSONL transcript manifest."""

import argparse
import ipaddress
import json
import mimetypes
import re
import statistics
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def words(text):
    normalized = []
    for char in unicodedata.normalize("NFKC", text).casefold():
        normalized.append(char if unicodedata.category(char)[0] in {"L", "N"} else " ")
    return "".join(normalized).split()


ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen"
).split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def number_words(n):
    """Say a number the way the references are written: 15 -> fifteen, 2026 -> twenty twenty six."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if 1100 <= n < 10000 and n % 100 >= 10:
        return number_words(n // 100) + " " + number_words(n % 100)
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + number_words(n % 100))
    return number_words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + number_words(n % 1000))


def spoken_form(text):
    """Rewrite written forms Whisper prefers into the spoken forms the references use.

    Digits, clock times, and am/pm become words, "github.com" becomes "github dot com",
    and hyphens inside words are dropped, so "mag-set" and "magset" or "i-send" and "isend" match.
    """
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"\b(\d{1,2})[:.](\d\d)\b", lambda m: f"{number_words(int(m[1]))} {number_words(int(m[2]))}", text)
    text = re.sub(r"\b(\d{1,2})\s*(am|pm)\b", lambda m: f"{number_words(int(m[1]))} {m[2]}", text)
    text = re.sub(r"\b(\w+)\.(com|org|net|ph)\b", r"\1 dot \2", text)
    text = re.sub(r"\d+", lambda m: number_words(int(m[0])), text)
    return re.sub(r"(?<=\w)-(?=\w)", "", text)


def word_error_rate(reference, hypothesis, normalize=False):
    if normalize:
        reference, hypothesis = spoken_form(reference), spoken_form(hypothesis)
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
        with LOCAL_OPENER.open(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"transcription request failed: {exc}") from exc
    elapsed_ms = (time.perf_counter() - started) * 1000
    if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
        raise RuntimeError("server response must be JSON with a string 'text' field")
    return payload["text"].strip(), round(elapsed_ms, 1)


def score(sample):
    """Add raw and spoken-form WER to a sample that has a reference and a transcript."""
    errors, reference_words = word_error_rate(sample["reference"], sample["transcript"])
    normalized_errors, normalized_words = word_error_rate(sample["reference"], sample["transcript"], normalize=True)
    return {
        **sample,
        "word_errors": errors,
        "reference_words": reference_words,
        "wer": errors / reference_words if reference_words else 0,
        "normalized_word_errors": normalized_errors,
        "normalized_reference_words": normalized_words,
        "normalized_wer": normalized_errors / normalized_words if normalized_words else 0,
    }


def summarize(samples):
    groups = defaultdict(list)
    for sample in samples:
        groups[sample["group"]].append(sample)
    summary = {}
    for name in ("taglish", "english"):
        rows = groups[name]
        if not rows:
            summary[name] = {
                "samples": 0,
                "word_errors": 0,
                "reference_words": 0,
                "wer": None,
                "normalized_wer": None,
                "mean_latency_ms": None,
                "median_latency_ms": None,
            }
            continue
        errors = sum(row["word_errors"] for row in rows)
        reference_words = sum(row["reference_words"] for row in rows)
        normalized_errors = sum(row["normalized_word_errors"] for row in rows)
        normalized_words = sum(row["normalized_reference_words"] for row in rows)
        summary[name] = {
            "samples": len(rows),
            "word_errors": errors,
            "reference_words": reference_words,
            "wer": errors / reference_words if reference_words else 0,
            "normalized_wer": normalized_errors / normalized_words if normalized_words else 0,
            "mean_latency_ms": round(statistics.mean(row["latency_ms"] for row in rows), 1),
            "median_latency_ms": round(statistics.median(row["latency_ms"] for row in rows), 1),
        }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", choices=("whisperkit", "whisper.cpp"))
    parser.add_argument("--model", help="Model label, recorded with the results")
    parser.add_argument("--endpoint", help="Local transcription HTTP endpoint")
    parser.add_argument("--manifest", help="JSONL rows: id, group, audio, reference")
    parser.add_argument("--audio-dir", help="External folder containing the consented recordings")
    parser.add_argument("--output", required=True, help="Output JSON report path")
    parser.add_argument("--language", default="auto", help="Whisper language hint (default: auto)")
    parser.add_argument("--timeout", type=float, default=1800, help="Per-clip timeout in seconds")
    parser.add_argument("--rescore", metavar="REPORT", help="Recompute WER for an existing report without a server")
    args = parser.parse_args()

    if args.rescore:
        report = rescore(json.loads(Path(args.rescore).read_text(encoding="utf-8")))
        write_report(report, args.output)
        return
    missing = [name for name in ("runtime", "model", "endpoint", "manifest", "audio_dir") if not getattr(args, name)]
    if missing:
        parser.error("the following arguments are required: " + ", ".join("--" + name.replace("_", "-") for name in missing))
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")
    validate_endpoint(args.endpoint)
    entries = load_manifest(args.manifest, args.audio_dir)
    first = entries[0]
    transcribe(args.endpoint, args.runtime, args.model, args.language, first["audio_path"], args.timeout)
    samples = []
    for item in entries:
        transcript, latency_ms = transcribe(
            args.endpoint, args.runtime, args.model, args.language, item["audio_path"], args.timeout
        )
        samples.append(score({
            "id": item["id"],
            "group": item["group"],
            "runtime": args.runtime,
            "model": args.model,
            "reference": item["reference"],
            "transcript": transcript,
            "latency_ms": latency_ms,
        }))
        print(f"{item['id']}: WER={samples[-1]['wer']:.3f}, latency={latency_ms:.1f} ms")

    report = {
        "runtime": args.runtime,
        "model": args.model,
        "language": args.language,
        "samples": samples,
        "summary": summarize(samples),
    }
    write_report(report, args.output)


def rescore(report):
    """Score an existing report again, for example after the scoring rules change. Other fields are kept."""
    samples = [score(sample) for sample in report["samples"]]
    return {**report, "samples": samples, "summary": summarize(samples)}


def write_report(report, path):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
