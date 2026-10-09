"""What the sweep checks and changes on the Mac, in one place, so the tests can swap in a fake.

These are a test tool's checks, judged from the Mac itself and never from the task's own status.
They use AppleScript for Notes, Reminders, Safari, and Spotify. That is fine here, outside the
product: Yumi itself never runs AppleScript (SPEC-05). The first use of each app asks macOS for
permission for the terminal that runs the sweep to control it.
"""
import os
import re
import shutil
import signal
import subprocess
import time
from pathlib import Path

HOME = Path.home()

KEYNOTE = "com.apple.Keynote"
NOTES = "com.apple.Notes"
REMINDERS = "com.apple.reminders"
SAFARI = "com.apple.Safari"
SPOTIFY = "com.spotify.client"
PREVIEW = "com.apple.Preview"


class MacError(Exception):
    pass


def lines(text):
    return [line for line in text.splitlines() if line.strip()]


class Mac:
    """The real Mac."""

    def __init__(self, home=HOME):
        self.home = Path(home)

    # Time

    def now(self):
        return time.time()

    def sleep(self, seconds):
        time.sleep(seconds)

    # Apps

    def osascript(self, script, timeout=30):
        done = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)
        if done.returncode != 0:
            raise MacError(done.stderr.strip() or f"osascript exited {done.returncode}")
        return done.stdout.strip()

    def pids(self, bundle_id):
        """The process ids of an app's running instances, from LaunchServices, read-only."""
        found = subprocess.run(["lsappinfo", "find", f"bundleid={bundle_id}"], capture_output=True, text=True).stdout
        pids = []
        for asn in re.findall(r"ASN:0x[0-9a-fA-F]+-0x[0-9a-fA-F]+", found):
            info = subprocess.run(["lsappinfo", "info", "-only", "pid", asn], capture_output=True, text=True).stdout
            match = re.search(r'"pid"=(\d+)', info)
            if match:
                pids.append(int(match.group(1)))
        return pids

    def is_running(self, bundle_id):
        return bool(self.pids(bundle_id))

    def front_bundle_id(self):
        front = subprocess.run(["lsappinfo", "front"], capture_output=True, text=True).stdout.strip()
        info = subprocess.run(["lsappinfo", "info", "-only", "bundleID", front], capture_output=True, text=True).stdout
        # "CFBundleIdentifier"="com.spotify.client"
        return info.split("=", 1)[1].strip().strip('"') if "=" in info else None

    def quit_app(self, bundle_id, wait=20):
        """Quits an app by process id, never by name or bundle id: every Yumi build shares one
        bundle id, so a quit sent that way could land on the wrong process (2026-10-10)."""
        for pid in self.pids(bundle_id):
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.time() + wait
        while self.pids(bundle_id) and time.time() < deadline:
            time.sleep(0.5)

    def close_preview_document(self, name):
        if self.is_running(PREVIEW):
            self.osascript(f'tell application id "{PREVIEW}" to close (every document whose name is "{name}")')

    def open_file(self, path, bundle_id=None):
        args = ["open"] + (["-b", bundle_id] if bundle_id else []) + [str(path)]
        subprocess.run(args, check=True)

    # Notes

    def note_ids(self):
        return set(lines(self.osascript(
            'tell application "Notes"\nset out to ""\nrepeat with i in (get id of every note)\nset out to out & i & linefeed\nend repeat\nreturn out\nend tell'
        )))

    def note(self, note_id):
        name = self.osascript(f'tell application "Notes" to get name of note id "{note_id}"')
        body = self.osascript(f'tell application "Notes" to get plaintext of note id "{note_id}"')
        return name, body

    def delete_note(self, note_id):
        self.osascript(f'tell application "Notes" to delete note id "{note_id}"')

    # Reminders

    def reminder_ids(self):
        return set(lines(self.osascript(
            'tell application "Reminders"\nset out to ""\nrepeat with i in (get id of every reminder)\nset out to out & i & linefeed\nend repeat\nreturn out\nend tell',
            timeout=60,
        )))

    def reminder(self, reminder_id):
        name = self.osascript(f'tell application "Reminders" to get name of reminder id "{reminder_id}"')
        due = self.osascript(
            f'tell application "Reminders"\nset d to due date of reminder id "{reminder_id}"\n'
            'if d is missing value then return ""\nreturn (d as «class isot» as string)\nend tell'
        )
        return name, due or None

    def delete_reminder(self, reminder_id):
        self.osascript(f'tell application "Reminders" to delete reminder id "{reminder_id}"')

    # Safari

    def safari_urls(self):
        if not self.is_running(SAFARI):
            return []
        return lines(self.osascript(
            'tell application "Safari"\nset out to ""\nrepeat with w in windows\nrepeat with t in tabs of w\n'
            'set out to out & (URL of t as text) & linefeed\nend repeat\nend repeat\nreturn out\nend tell'
        ))

    def close_safari_tabs(self, url):
        self.osascript(
            f'tell application "Safari"\nrepeat with w in windows\nclose (every tab of w whose URL is "{url}")\nend repeat\nend tell'
        )

    # Spotify

    def spotify_state(self):
        if not self.is_running(SPOTIFY):
            return None
        return self.osascript('tell application "Spotify" to player state as text')

    def spotify_pause(self):
        if self.is_running(SPOTIFY):
            self.osascript('tell application "Spotify" to pause')

    # Files

    def snapshot(self, folders):
        """The files directly in each folder: path -> (inode, size, mtime). Folders themselves count too."""
        files = {}
        for folder in folders:
            folder = Path(folder)
            if not folder.is_dir():
                continue
            for entry in os.scandir(folder):
                try:
                    st = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                files[entry.path] = (st.st_ino, st.st_size, st.st_mtime)
        return files

    def write(self, path, data, mtime=None):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode())
        if mtime is not None:
            os.utime(path, (mtime, mtime))

    def exists(self, path):
        return Path(path).exists()

    def read_head(self, path, n=5):
        with open(path, "rb") as f:
            return f.read(n)

    def trash(self, path):
        """Moves a file the run made to the Trash, never deleting it outright."""
        path = Path(path)
        if not path.exists():
            return
        target = self.home / ".Trash" / path.name
        stamp = 1
        while target.exists():
            target = self.home / ".Trash" / f"{path.stem} {stamp}{path.suffix}"
            stamp += 1
        shutil.move(str(path), str(target))
