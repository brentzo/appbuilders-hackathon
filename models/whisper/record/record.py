#!/usr/bin/env python3
"""Record the Whisper test corpus on this Mac, one goal at a time.

Usage:
    python3 models/whisper/record/record.py              # record every goal not recorded yet
    python3 models/whisper/record/record.py --redo tl-03 # record one goal again

Audio is saved outside git (default: ~/Yumi recordings/whisper) as 16 kHz mono WAV.
The reference transcripts are written to models/whisper/transcripts.jsonl, the manifest benchmark.py reads.
"""

import argparse
import array
import hashlib
import json
import os
import subprocess
import sys
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
WHISPER = os.path.dirname(HERE)
PROMPTS = os.path.join(HERE, "prompts.jsonl")
MANIFEST = os.path.join(WHISPER, "transcripts.jsonl")
SOURCE = os.path.join(HERE, "recorder.swift")
DEFAULT_OUT = os.path.expanduser("~/Yumi recordings/whisper")


def load_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def save_manifest(rows):
    order = {p["id"]: i for i, p in enumerate(load_jsonl(PROMPTS))}
    rows = sorted(rows, key=lambda r: order.get(r["id"], len(order)))
    with open(MANIFEST, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_recorder():
    """Compile recorder.swift once and cache it by source hash."""
    with open(SOURCE, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:12]
    cache = os.path.expanduser("~/Library/Caches/yumi")
    binary = os.path.join(cache, f"whisper-recorder-{digest}")
    if not os.path.exists(binary):
        os.makedirs(cache, exist_ok=True)
        print("Building the recorder (first run only)...")
        result = subprocess.run(["swiftc", "-O", SOURCE, "-o", binary], capture_output=True, text=True)
        if result.returncode != 0:
            sys.exit("Could not build the recorder. Is Xcode or the Command Line Tools installed?\n" + result.stderr)
    return binary


def check_microphone(recorder):
    result = subprocess.run([recorder, "--check"], capture_output=True, text=True)
    if "NO_MIC_PERMISSION" in result.stdout:
        sys.exit(
            "This terminal is not allowed to use the microphone.\n"
            "Open System Settings, Privacy & Security, Microphone, turn it on for your terminal app, "
            "then quit and reopen the terminal and run this again."
        )
    if result.returncode != 0:
        sys.exit("Could not check the microphone:\n" + result.stdout + result.stderr)
    return result.stdout.strip().removeprefix("MIC ")


def peak_level(path):
    """Loudest sample as a fraction of full scale, to catch a muted or wrong microphone."""
    with wave.open(path) as w:
        samples = array.array("h", w.readframes(w.getnframes()))
    return max((abs(s) for s in samples), default=0) / 32768


def record_once(recorder, path):
    proc = subprocess.Popen([recorder, path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    first = proc.stdout.readline().strip()
    if first != "RECORDING":
        proc.kill()
        print("  Could not start recording: " + first)
        return None
    input("  ● Recording. Say it now, then press Enter when you finish speaking. ")
    out, _ = proc.communicate("\n")
    for line in out.splitlines():
        if line.startswith("STOPPED"):
            return float(line.split()[1])
    print("  The recording did not finish cleanly: " + out.strip())
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=DEFAULT_OUT, help="where audio goes, outside git (default: %(default)s)")
    parser.add_argument("--redo", metavar="ID", help="record one goal again, for example tl-03")
    args = parser.parse_args()

    prompts = load_jsonl(PROMPTS)
    manifest = {row["id"]: row for row in load_jsonl(MANIFEST)}
    os.makedirs(args.out, exist_ok=True)
    recorder = build_recorder()
    mic = check_microphone(recorder)

    if args.redo:
        todo = [p for p in prompts if p["id"] == args.redo]
        if not todo:
            sys.exit(f"No goal with id {args.redo}. Ids are in {PROMPTS}.")
    else:
        todo = [p for p in prompts if not os.path.exists(os.path.join(args.out, p["id"] + ".wav"))]

    print(f"Microphone: {mic}")
    print(f"Audio goes to: {args.out}")
    print(f"{len(prompts) - len(todo)} of {len(prompts)} already recorded, {len(todo)} to go.")
    print("Speak the way you would really talk to Yumi, at your normal distance from the Mac.")
    print("If you say it a bit differently, keep it and type what you actually said with 'e'.\n")

    for n, prompt in enumerate(todo, 1):
        audio = prompt["id"] + ".wav"
        path = os.path.join(args.out, audio)
        reference = manifest.get(prompt["id"], {}).get("reference", prompt["text"])
        print(f"[{n}/{len(todo)}] {prompt['group']}  {prompt['id']}")
        print(f"  \"{reference}\"")
        choice = input("  Press Enter to start (s = skip, q = quit): ").strip().lower()
        if choice == "q":
            break
        if choice == "s":
            print()
            continue
        while True:
            seconds = record_once(recorder, path)
            if seconds is not None and seconds < 0.6:
                print(f"  That was only {seconds:.1f} s. Let's try again.")
                continue
            if seconds is not None and peak_level(path) < 0.01:
                print("  That sounded silent. Check the microphone is not muted, then try again.")
                continue
            if seconds is None:
                retry = input("  Press Enter to try again, or q to quit: ").strip().lower()
                if retry == "q":
                    save_manifest(list(manifest.values()))
                    return 1
                continue
            choice = input(f"  Saved {seconds:.1f} s. Enter = next, p = play, r = redo, e = edit transcript: ").strip().lower()
            while choice == "p":
                subprocess.run(["afplay", path])
                choice = input("  Enter = next, p = play, r = redo, e = edit transcript: ").strip().lower()
            if choice == "r":
                continue
            if choice == "e":
                typed = input("  Type exactly what you said: ").strip()
                if typed:
                    reference = typed
            break
        manifest[prompt["id"]] = {"id": prompt["id"], "group": prompt["group"], "audio": audio, "reference": reference}
        save_manifest(list(manifest.values()))
        print()

    done = sum(os.path.exists(os.path.join(args.out, p["id"] + ".wav")) for p in prompts)
    print(f"{done} of {len(prompts)} goals recorded.")
    print(f"Transcripts: {os.path.relpath(MANIFEST)}. Audio stays in {args.out}; never add it to git.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nStopped. Everything recorded so far is saved; run it again to continue.")
        sys.exit(130)
