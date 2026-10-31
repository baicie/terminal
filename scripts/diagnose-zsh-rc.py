#!/usr/bin/env python3
"""Capture per-rc zsh transcripts to diagnose the Linux shell-probe timeouts.

The failing cases are readline-history, readline-tab and pty-resize - exactly
the ones that need ZLE. bash passes all seven, zsh loses those three.

This runs each rc variant under a real PTY and records what the shell actually
does with a typed command, so the Linux runner produces evidence instead of a
guess. It deliberately reports only measurements that were verified to hold on
a host where the probe passes:

  * shell-started / interactive
  * the typed command executed and its marker reached the PTY

Two earlier versions of this script reported proxies that were wrong even on a
passing host, and were removed rather than shipped:

  - [[ -o zle ]] is off whenever a command runs, so it is always false.
  - driving the line editor with a raw ESC [ A did not reproduce history recall
    on macOS, where the probe passes, so the result was noise.

Raw transcripts are written to disk and uploaded as an artifact; the real
comparison happens on the Linux runner.

    python3 scripts/diagnose-zsh-rc.py --shells zsh,bash --out zsh-diag.log
"""

from __future__ import annotations

import argparse
import os
import pty
import select
import shutil
import sys
import tempfile
import time

MARK = "__PROBE_MARK_XYZ__"
PROBE = "echo " + MARK

APP_ZSHRC = "\n".join([
    'if [ -n "$TERMINAL_REAL_ZDOTDIR" ]; then export ZDOTDIR="$TERMINAL_REAL_ZDOTDIR"; else unset ZDOTDIR; fi',
    "__TI_A(){ printf '\\033]133;A\\007'; }",
    "__TI_B(){ printf '\\033]133;B\\007'; }",
    "autoload -Uz add-zsh-hook",
    "add-zsh-hook precmd __TI_A",
    "add-zsh-hook preexec __TI_B",
    "",
])

VARIANTS = {
    "no-rc": {},
    "minimal-rc": {".zshrc": 'PS1="%% "\n'},
    "app-rc": {".zshrc": APP_ZSHRC},
    "app-rc-vi-keymap": {".zshrc": APP_ZSHRC + "bindkey -v\n"},
    "app-rc-emacs-keymap": {".zshrc": APP_ZSHRC + "bindkey -e\n"},
}


def run_variant(shell, name, files):
    home = tempfile.mkdtemp(prefix="zsh-diag-")
    try:
        for filename, body in files.items():
            with open(os.path.join(home, filename), "w", encoding="utf-8") as handle:
                handle.write(body)

        env = dict(os.environ)
        env.update({"HOME": home, "ZDOTDIR": home, "TERM": "xterm-256color"})
        pid, fd = pty.fork()
        if pid == 0:
            try:
                os.execvpe(shell, [shell, "-i"], env)
            finally:
                os._exit(127)

        sink = bytearray()
        deadline = time.time() + 25
        sent = False
        while time.time() < deadline:
            ready, _, _ = select.select([fd], [], [], 0.3)
            if not ready:
                if sent:
                    break
                continue
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            sink.extend(chunk)
            if not sent and (b"$" in bytes(sink) or b"%" in bytes(sink) or b"#" in bytes(sink)):
                os.write(fd, (PROBE + "\nexit\n").encode())
                sent = True

        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            pass

        text = sink.decode("utf-8", "replace")
        return {
            "shell": shell,
            "variant": name,
            "started": len(text) > 0,
            "executed": MARK in text,
            "transcript": text,
        }
    finally:
        shutil.rmtree(home, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shells", default="zsh,bash")
    parser.add_argument("--out", default="zsh-diag.log")
    args = parser.parse_args()

    rows = []
    for shell in args.shells.split(","):
        if shutil.which(shell) is None:
            print("SKIP " + shell + ": not installed", file=sys.stderr)
            continue
        for name, files in VARIANTS.items():
            rows.append(run_variant(shell, name, files))

    lines = ["shell | variant | started | typed-command-executed", "--- | --- | --- | ---"]
    for row in rows:
        lines.append("{0} | {1} | {2} | {3}".format(row["shell"], row["variant"], row["started"], row["executed"]))
    print("\n".join(lines))

    with open(args.out, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
        for row in rows:
            handle.write("\n===== " + row["shell"] + "/" + row["variant"] + " =====\n")
            handle.write(repr(row["transcript"]) + "\n")
    print()
    print("transcripts written to " + args.out)

    lost = [row for row in rows if not row["executed"]]
    if lost:
        print("VARIANTS THAT DID NOT EXECUTE THE TYPED COMMAND:")
        for row in lost:
            print("  " + row["shell"] + "/" + row["variant"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
