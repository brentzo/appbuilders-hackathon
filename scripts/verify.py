#!/usr/bin/env python3
"""Run every check a change needs before it is committed or pushed.

Usage:
    python3 scripts/verify.py          # checks for files changed since origin/main, committed or not
    python3 scripts/verify.py --all    # every check

Specs are inputs to product tests (protocol and android read SPEC-11), so a spec change runs those too.
Exit code 1 if any check fails or a needed check could not run. Never push past a failure or a skip.
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WINDOWS = os.name == "nt"


def changed_files():
    def lines(*args):
        out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
        return out.stdout.splitlines() if out.returncode == 0 else []

    base = lines("merge-base", "HEAD", "origin/main")
    files = set(lines("diff", "--name-only", base[0])) if base else set()
    files |= set(lines("diff", "--name-only", "HEAD"))
    files |= set(lines("ls-files", "--others", "--exclude-standard"))
    return files


def touches(files, *prefixes):
    return any(f.startswith(prefixes) for f in files)


def run(name, cmd, cwd=ROOT, env=None):
    print(f"\n== {name}: {' '.join(cmd)}", flush=True)
    code = subprocess.run(cmd, cwd=cwd, env=env, shell=WINDOWS).returncode
    print(f"== {name}: {'passed' if code == 0 else 'FAILED'}", flush=True)
    return code == 0


def protocol():
    cwd = os.path.join(ROOT, "protocol")
    if not shutil.which("npm"):
        return None, "npm is not installed"
    if not os.path.isdir(os.path.join(cwd, "node_modules")) and not run("protocol install", ["npm", "ci"], cwd):
        return False, None
    ok = run("protocol generated types", ["npm", "run", "check:generated"], cwd)
    ok = run("protocol typecheck and tests", ["npm", "run", "verify"], cwd) and ok
    return ok, None


def harness():
    cwd = os.path.join(ROOT, "harness")
    if not os.path.exists(os.path.join(cwd, "package.json")):
        return True, None  # nothing built yet, only the README
    if not shutil.which("npm"):
        return None, "npm is not installed"
    if not os.path.isdir(os.path.join(cwd, "node_modules")) and not run("harness install", ["npm", "ci"], cwd):
        return False, None
    return run("harness typecheck, lint, format, tests", ["npm", "run", "verify"], cwd), None


def node_product(folder):
    """A Node product whose package.json has a verify script: install once, then npm run verify."""
    def check():
        cwd = os.path.join(ROOT, folder)
        if not os.path.exists(os.path.join(cwd, "package.json")):
            return True, None  # nothing built yet, only the README
        if not shutil.which("npm"):
            return None, "npm is not installed"
        if not os.path.isdir(os.path.join(cwd, "node_modules")) and not run(f"{folder} install", ["npm", "ci"], cwd):
            return False, None
        return run(f"{folder} checks", ["npm", "run", "verify"], cwd), None
    return check


def mac():
    """The Mac app: build and run its tests (unit tests, the SPEC-11 copy check, RPC tests against the mock harness)."""
    if not shutil.which("xcodebuild"):
        return None, "needs a Mac with Xcode"
    cwd = os.path.join(ROOT, "mac")
    if not os.path.isdir(os.path.join(ROOT, "protocol", "node_modules")) and not run("protocol install", ["npm", "ci"], os.path.join(ROOT, "protocol")):
        return False, None
    # Ad hoc signing (empty DEVELOPMENT_TEAM): the tests need no personal team, and it works for everyone.
    cmd = ["xcodebuild", "-project", "Yumi.xcodeproj", "-scheme", "Yumi", "-derivedDataPath", "build", "-quiet", "DEVELOPMENT_TEAM=", "test"]
    return run("mac build and tests", cmd, cwd), None


def docker_running():
    return shutil.which("docker") is not None and subprocess.run(
        ["docker", "info"], capture_output=True, shell=WINDOWS).returncode == 0


def protocol_native():
    """Swift and Kotlin round trips run in Docker, as in CI. Optional locally: CI still runs them on push."""
    if not docker_running():
        return None, "Docker is not running; CI runs these on push"
    cwd = os.path.join(ROOT, "protocol")
    ok = run("protocol Swift round trip", ["npm", "run", "compile:swift"], cwd)
    ok = run("protocol Kotlin round trip", ["npm", "run", "compile:kotlin"], cwd) and ok
    return ok, None


def android():
    cwd = os.path.join(ROOT, "android")
    env = dict(os.environ)
    if "ANDROID_HOME" not in env and not os.path.exists(os.path.join(cwd, "local.properties")):
        default = os.path.expanduser("~/Library/Android/sdk")
        if not os.path.isdir(default):
            return None, "no Android SDK (set ANDROID_HOME or android/local.properties)"
        env["ANDROID_HOME"] = default
    gradlew = "gradlew.bat" if WINDOWS else "./gradlew"
    # --rerun-tasks is not needed: specs/ is a declared test input, so a spec change reruns the copy test.
    return run("android build, tests, lint", [gradlew, "--no-daemon", "assembleDebug", "testDebugUnitTest", "lintDebug"], cwd, env), None


def whisper():
    return run("models/whisper tests", [sys.executable, "-m", "unittest", "discover", "-s", "models/whisper", "-p", "test_*.py"]), None


CHECKS = [
    # (name, runs when any changed path starts with one of these, check, required)
    ("protocol", ("protocol/", "specs/"), protocol, True),
    ("protocol Swift and Kotlin", ("protocol/",), protocol_native, False),
    # The harness depends on @yumi/protocol, so a protocol change runs its tests too.
    ("harness", ("harness/", "protocol/", "specs/"), harness, True),
    ("bridge", ("bridge/", "protocol/"), node_product("bridge"), True),
    # The Mac app compiles the generated Swift types and checks its copy against SPEC-11. Only a Mac can build it.
    ("mac", ("mac/", "protocol/", "specs/"), mac, False),
    ("android", ("android/", "specs/"), android, True),
    ("models/whisper", ("models/whisper/",), whisper, True),
]


def main():
    everything = "--all" in sys.argv[1:]
    files = changed_files()
    results = []
    results.append(("objectives and docs", run("objectives and docs", [sys.executable, "scripts/objectives.py", "check"]), None, True))
    for name, prefixes, check, required in CHECKS:
        if everything or touches(files, *prefixes):
            ok, why = check()
            results.append((name, ok, why, required))
    print("\nSummary:")
    failed = False
    for name, ok, why, required in results:
        if ok:
            print(f"- {name}: passed")
        elif ok is None and not required:
            print(f"- {name}: not run ({why})")
        else:
            failed = True
            print(f"- {name}: {'FAILED' if ok is False else 'SKIPPED (' + why + ')'}")
    print("\nNot ready to push." if failed else "\nReady to commit and push.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
