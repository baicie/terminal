#!/usr/bin/env python3
"""Drive the failing shell-probe cases under a real PTY and time them.

Phase 8.9 Task 6. Three zsh cases time out inside the app on the Linux runner
(readline-history, readline-tab, pty-resize) while the same seven cases pass on
macOS and bash passes all seven on Linux. This reproduces the app's launch
exactly -- the login shell plus the ZDOTDIR wrapper the backend writes -- and
drives the same keystrokes with the same delays through a PTY, so the failing
interaction can be measured outside the GUI.

Recorded per case, all of it measured rather than inferred:

  * ZDOTDIR/HOME values and modes, plus the interactive options and keymaps the
    startup files actually left behind (from a throwaway child, so the session
    under test is never disturbed)
  * the write/echo timeline in milliseconds: when bytes reached the PTY master,
    and when (if ever) the shell echoed them back
  * ZLE state at every write, derived from the cursor-key sequence ZLE itself
    emits (ESC [ ? 1 h on entry, ESC [ ? 1 l on exit)
  * marker arrival per trace event, so "the shell never printed it" and "the
    buffer never saw it" stop looking the same
  * for pty-resize, the winsize the kernel reports back after each resize

Two proxies were measured on a passing host and rejected before this version,
because they report the opposite of the truth:

  - [[ -o zle ]] is off for the whole time a command runs, so it is false
    exactly when a command could observe it.
  - sending a bare ESC [ A and assuming history recall is not comparable across
    hosts; it did not reproduce on macOS, where the probe passes.

Usage:
    python3 scripts/diagnose-zsh-rc.py --shells zsh --cases all --out diag.log
"""

from __future__ import annotations

import argparse
import errno
import fcntl
import os
import pty
import re
import select
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

NL = chr(10)
CR = chr(13)
TAB = chr(9)
ESC = chr(27)
BS = chr(92)

INITIAL_COLS, INITIAL_ROWS = 100, 32
RESIZE_SEQUENCE = [(132, 43), (90, 30), (120, 40), (97, 31)]
RESIZE_STEP_DELAY_MS = 300
SLEEP_SECONDS = 20
CASE_TIMEOUT_S = 30.0
RAW_DUMP_LIMIT = 12000
ALL_CASES = ['readline-history', 'readline-tab', 'pty-resize', 'ctrl-c-interrupt']

# Three launch models, and the reason each exists. Mixing them is what made the
# previous matrix unreadable: a timeout under one model says nothing about the
# others.
#
#   app    the product with shell integration: zsh reads the ZDOTDIR wrapper
#          src-tauri/src/session/shell_startup.rs writes, then the user's own
#          files. This is the only model the product gate measures.
#   plain  the product without shell integration: a real account whose rc files
#          exist but carry no integration hooks. Expected to PASS; a failure
#          here is a line-editor or PTY problem, which is a product problem.
#   bare   the negative control: interactive zsh with HOME empty and no rc file
#          at all. Expected to FAIL, and to fail for one documented reason - the
#          shell blocks in the system-wide rc (newuser wizard or compinit) and
#          never reaches ZLE. It proves the harness can see a blocked shell.
LAUNCH_MODELS = {
    'app': {
        'purpose': 'product with shell integration (the gate)',
        'startup_files': 'ZDOTDIR wrapper written by shell_startup.rs',
        'login': True,
        'expectation': 'pass',
        'product': True,
    },
    'plain': {
        'purpose': 'product without shell integration, rc files present',
        'startup_files': 'minimal .zshenv + .zshrc in HOME',
        'login': False,
        'expectation': 'pass',
        'product': True,
    },
    'bare': {
        'purpose': 'negative control: no startup file at all',
        'startup_files': 'none',
        'login': False,
        'expectation': 'fail',
        'product': False,
    },
}
DEFAULT_LAUNCHES = 'app,plain,bare'

# The shell is blocked when it is waiting for an answer to a question printed by
# the system-wide rc: Debian's /etc/zsh/zshrc runs compinit, and compinit stops
# on insecure directories. These are the strings those prompts actually contain.
BLOCKAGE_SIGNATURES = (
    'zsh-newuser-install',
    'insecure directories',
    'abort compinit',
    'continue [y] or abort',
    'Do you want to',
    'compinit:',
)

CLASS_PASS = 'PASS'
CLASS_EXPECTED = 'EXPECTED_FAILURE'
CLASS_DIAGNOSTIC = 'DIAGNOSTIC_FAILURE'
CLASS_PRODUCT = 'PRODUCT_FAILURE'
FAILING_CLASSES = (CLASS_PRODUCT, CLASS_DIAGNOSTIC)
INTERESTING_OPTIONS = (
    'interactive', 'login', 'zle', 'promptsubst', 'shinstdin', 'monitor',
    'histappend', 'incappendhistory', 'sharehistory', 'autolist',
    'menucomplete', 'promptcr', 'emacs', 'vi',
)

# ZLE brackets every line edit with two sequences it emits itself, so they are a
# measurement of the line editor's ownership and not a proxy for it:
#
#   ESC [ ? 2004 h / l  bracketed paste on/off (zsh >= 5.1, emitted by zle
#                       around each line edit; this host emitted nothing else)
#   ESC [ ? 1 h / l     alternate cursor keys (terminfo smkx/rmkx); only when
#                       the terminal description carries it, so it is read as a
#                       secondary signal and never on its own
ZLE_RE = re.compile(rb'\x1b\[\?(2004|1)([hl])')
ZLE_KIND = {b'2004': 'paste', b'1': 'keys'}

DOLLAR = chr(36)
OPEN, CLOSE = '{', '}'
REAL_VAR = DOLLAR + OPEN + 'TERMINAL_REAL_ZDOTDIR' + CLOSE
RC_DIR = '"' + DOLLAR + OPEN + 'TERMINAL_REAL_ZDOTDIR:-' + DOLLAR + 'HOME' + CLOSE + '"'
BASHVAR = DOLLAR + OPEN
QUOTE = chr(34)


def forward(name):
    return 'if [ -r {0}/{1} ]; then source {0}/{1}; fi' + NL


def wrapper_files():
    """The ZDOTDIR wrapper from src-tauri/src/session/shell_startup.rs."""
    hook = (
        "printf '" + BS + "033]133;D;%s" + BS + "007' " + QUOTE + DOLLAR + "?" + QUOTE
        + "; printf '" + BS + "033]133;A" + BS + "007'; printf '" + BS
        + "033]7;file://%s" + BS + "007' " + QUOTE + DOLLAR + "PWD" + QUOTE
    )
    zshrc = ''.join([
        'if [ -n "' + REAL_VAR + '" ]; then export ZDOTDIR="' + REAL_VAR
        + '"; else unset ZDOTDIR; fi' + NL,
        forward('.zshrc'),
        '__TI_A() { ' + hook + '; }' + NL,
        "__TI_B() { printf '" + BS + "033]133;B" + BS + "007'; }" + NL,
        'autoload -Uz add-zsh-hook' + NL,
        'add-zsh-hook precmd __TI_A' + NL,
        'add-zsh-hook preexec __TI_B' + NL,
    ])
    return {
        # skip_global_compinit is zsh's documented switch for the system-wide
        # /etc/zsh/zshrc, which calls compinit and then blocks on
        # "insecure directories ... continue [y] or abort compinit [n]?" in a
        # fresh PTY, swallowing the injected bytes. Phase 8.8 removed that
        # confounder; the Task 6 rewrite dropped it and the prompt came back,
        # so every variant was measured against a blocked shell again.
        '.zshenv': 'skip_global_compinit=1' + NL + forward('.zshenv'),
        '.zprofile': forward('.zprofile'),
        '.zshrc': zshrc,
        '.zlogin': forward('.zlogin'),
    }


def plain_startup_files():
    """Startup files for a real account that has no shell integration.

    skip_global_compinit is the documented switch for the system-wide rc, and it
    is required here for the same reason the app wrapper sets it: without it
    Debian's /etc/zsh/zshrc runs compinit, which stops on insecure directories
    and swallows everything typed at the shell. A "plain" variant without this
    line does not measure a plain shell, it measures a blocked one.
    """
    return {
        '.zshenv': 'skip_global_compinit=1' + NL + forward('.zshenv'),
        '.zshrc': 'PS1=' + QUOTE + '%# ' + QUOTE + NL + forward('.zshrc'),
    }


def split_marker(marker):
    cut = (len(marker) + 1) // 2
    return marker[:cut], marker[cut:]


class Markers:
    def __init__(self, nonce):
        prefix = '__TERMINAL_SHELL_PROBE_{0}_'.format(nonce)
        self.ready = prefix + 'READY__'
        self.step = prefix + 'STEP__'
        self.pass_ = prefix + 'PASS__'
        self.fail = prefix + 'FAIL__'
        self.size = prefix + 'SIZE__'

    def printf(self, marker):
        head, tail = split_marker(marker)
        fmt = "printf '" + BS + 'r' + BS + "n%s%s" + BS + 'r' + BS + "n'"
        return fmt + " '{0}' '{1}'".format(head, tail)

    def echo_split(self, marker):
        head, tail = split_marker(marker)
        return 'echo -n {0}; echo {1}'.format(head, tail)


class Session:
    """A PTY child plus a timestamped log of everything on the wire."""

    def __init__(self, argv, env, cwd, cols=INITIAL_COLS, rows=INITIAL_ROWS):
        self.events = []
        self.lock = threading.Lock()
        self.raw = bytearray()
        self.done = False
        self.started = time.monotonic()
        pid, fd = pty.fork()
        if pid == 0:
            try:
                fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                os.chdir(cwd)
                os.execvpe(argv[0], argv, env)
            finally:
                os._exit(127)
        self.pid, self.fd = pid, fd
        threading.Thread(target=self._read_loop, daemon=True).start()

    def now(self):
        return time.monotonic() - self.started

    def _record(self, kind, data):
        at = self.now()
        with self.lock:
            self.events.append((at, kind, bytes(data)))
            if kind == 'recv':
                self.raw.extend(data)
        return at

    def _read_loop(self):
        while not self.done:
            try:
                ready, _, _ = select.select([self.fd], [], [], 0.05)
            except (OSError, ValueError):
                return
            if not ready:
                continue
            try:
                chunk = os.read(self.fd, 65536)
            except OSError as error:
                # EIO: the pty slave is gone. EBADF: the main thread closed the
                # descriptor while this reader was still blocked. That is normal
                # teardown, not a diagnosis failure, and re-raising it crashed a
                # thread per variant on the Linux runner.
                if error.errno in (errno.EIO, errno.EBADF):
                    return
                raise
            if not chunk:
                return
            self._record('recv', chunk)

    def write(self, data, label):
        data = data.encode() if isinstance(data, str) else data
        at = self._record('write:' + label, data)
        try:
            os.write(self.fd, data)
        except OSError as error:
            self._record('write-failed:' + label, str(error).encode())
        return at

    def resize(self, cols, rows, label):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        return self._record('resize:' + label, '{0}x{1}'.format(cols, rows).encode())

    def text(self):
        with self.lock:
            return self.raw.decode('utf-8', 'replace')

    def snapshot(self):
        with self.lock:
            return list(self.events), self.raw.decode('utf-8', 'replace')

    def close(self):
        self.done = True
        try:
            os.close(self.fd)
        except OSError:
            pass
        for action in (signal.SIGHUP, signal.SIGKILL):
            try:
                os.kill(self.pid, action)
                time.sleep(0.05)
            except OSError:
                break
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass


def zle_state(events, upto):
    """ZLE ownership from the last line-editor sequence printed before a moment."""
    state = 'unknown'
    for at, kind, data in events:
        if at > upto:
            break
        if kind != 'recv':
            continue
        for match in ZLE_RE.finditer(data):
            state = ('active' if match.group(2) == b'h' else 'inactive') \
                + '(' + ZLE_KIND[match.group(1)] + ')'
    return state


def fmt(data, limit=70):
    text = data.decode('utf-8', 'replace')
    out = ''.join(
        ch if 32 <= ord(ch) < 127 else BS + 'x{0:02x}'.format(ord(ch) & 0xFF)
        for ch in text
    )
    return out if len(out) <= limit else out[:limit] + '...'


def wait_for(session, needle, deadline):
    while time.monotonic() < deadline:
        if needle in session.text():
            return session.now()
        time.sleep(0.004)
    return None


def wait_verdict(session, markers, deadline):
    while time.monotonic() < deadline:
        text = session.text()
        if markers.pass_ in text:
            return 'pass'
        if markers.fail in text:
            return 'fail'
        time.sleep(0.004)
    return None


def case_plan(case, markers):
    ready = markers.printf(markers.ready)
    if case == 'readline-history':
        return {
            'setup': ready,
            'step_command': (
                'if [ "' + DOLLAR + OPEN + 'SHELL_PROBE_HISTORY_SEEN:-0' + CLOSE
                + '" -eq 0 ]; then SHELL_PROBE_HISTORY_SEEN=1; '
                + markers.printf(markers.step) + '; else '
                + markers.printf(markers.pass_) + '; fi'
            ),
            'after_step': [(120, ESC + '[A' + CR, 'history-up')],
        }
    if case == 'readline-tab':
        head, tail = split_marker(markers.pass_)
        fmt = "printf '" + BS + 'r' + BS + "n%s%s" + BS + 'r' + BS + "n'"
        return {
            'setup': (
                'SHELL_PROBE_DIR=' + DOLLAR + '(mktemp -d); ' + fmt
                + " '" + head + "' '" + tail + "'"
                + ' > "' + DOLLAR + 'SHELL_PROBE_DIR/alpha_probe"; cd "'
                + DOLLAR + 'SHELL_PROBE_DIR"; ' + ready
            ),
            'step_command': markers.printf(markers.step),
            'after_step': [(0, 'cat alp', 'tab-word'), (120, TAB, 'tab'),
                           (240, CR, 'tab-enter')],
        }
    if case == 'ctrl-c-interrupt':
        return {
            'setup': 'stty echo; {0}; stty -echo'.format(ready),
            'step_command': '{0}; sleep {1}'.format(
                markers.printf(markers.step), SLEEP_SECONDS),
            'after_step': [(200, chr(3), 'ctrl-c'),
                           (900, markers.printf(markers.pass_) + CR, 'pass')],
        }
    raise SystemExit('unsupported case ' + case)


def run_resize(session, markers, deadline):
    observations = []
    written = []
    cursor = [0]
    fmt = "printf '" + BS + 'r' + BS + "n%s%s:%s_%s" + BS + 'r' + BS + "n'"
    last_index = len(RESIZE_SEQUENCE) - 1
    for index, (cols, rows) in enumerate(RESIZE_SEQUENCE):
        time.sleep(RESIZE_STEP_DELAY_MS / 1000.0)
        session.resize(cols, rows, 'resize-{0}'.format(index))
        head, tail = split_marker(markers.size)
        command = (
            'set -- ' + DOLLAR + '(stty size); ' + fmt
            + " '" + head + "' '" + tail + "' \"" + DOLLAR + '1\" \"'
            + DOLLAR + '2\"'
        )
        if index == last_index:
            written.append(command)
            command += (
                '; if [ ' + QUOTE + DOLLAR + '1' + QUOTE + ' = ' + repr(str(rows))
                + ' ] && [ ' + QUOTE + DOLLAR + '2' + QUOTE + ' = ' + repr(str(cols))
                + ' ]; then ' + markers.printf(markers.step) + '; '
                + markers.printf(markers.pass_) + '; else '
                + markers.printf(markers.fail) + '; fi'
            )
        session.write(command + CR, 'resize-probe-{0}'.format(index))
        expected = markers.size + ':{0}_{1}'.format(rows, cols)
        seen = wait_for(session, expected, time.monotonic() + 5.0)
        fresh = session.text()[cursor[0]:]
        found = re.search(re.escape(markers.size) + ':([0-9]+)_([0-9]+)', fresh)
        observed = (int(found.group(2)), int(found.group(1))) if found else None
        observations.append({'step': index, 'requested': (cols, rows),
                              'observed': observed, 'arrived': seen is not None})
        if found:
            cursor[0] += found.end()
    return observations


def run_case(shell, case, launch):
    markers = Markers('diag')
    home = tempfile.mkdtemp(prefix='probe-home-')
    wrapper = None
    session = None
    try:
        env = dict(os.environ)
        env.update({'HOME': home, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor'})
        env.pop('ZDOTDIR', None)
        env.pop('TERMINAL_REAL_ZDOTDIR', None)
        model = LAUNCH_MODELS[launch]
        argv = [shell]
        written = []
        if launch == 'app':
            wrapper = tempfile.mkdtemp(prefix='terminal-shell-')
            os.chmod(wrapper, 0o700)
            for name, body in wrapper_files().items():
                path = os.path.join(wrapper, name)
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(body)
                os.chmod(path, 0o700)
            env['ZDOTDIR'] = wrapper
            env['TERM_PROGRAM'] = 'Terminal'
            env['TERMINAL_SHELL_INTEGRATION'] = '1'
            written = sorted(wrapper_files())
        elif launch == 'plain':
            # The whole point of this model: the files exist, and the only thing
            # missing compared with "app" is the integration wrapper.
            for name, body in plain_startup_files().items():
                path = os.path.join(home, name)
                with open(path, 'w', encoding='utf-8') as handle:
                    handle.write(body)
                os.chmod(path, 0o600)
                written = written + [name]
        elif launch != 'bare':
            raise SystemExit('unsupported launch model: ' + launch)
        argv.append('-l' if model['login'] else '-i')
        session = Session(argv, env, cwd=home)
        deadline = time.monotonic() + CASE_TIMEOUT_S
        result = {'case': case, 'launch': launch, 'shell': shell, 'session': session,
                  'markers': markers, 'home': home, 'wrapper': wrapper,
                  'reason': None, 'resize': None, 'startup_files': written,
                  'argv': argv, 'zdotdir': env.get('ZDOTDIR'), 'diagnostic_error': None}
        if case == 'pty-resize':
            session.write(markers.printf(markers.ready) + CR, 'setup')
            if wait_for(session, markers.ready, deadline) is None:
                result.update(verdict='timeout', reason='ready marker never printed')
                return result
            result['resize'] = run_resize(session, markers, deadline)
        else:
            plan = case_plan(case, markers)
            session.write(plan['setup'] + CR, 'setup')
            if wait_for(session, markers.ready, deadline) is None:
                result.update(verdict='timeout', reason='ready marker never printed')
                return result
            session.write(plan['step_command'] + CR, 'step-command')
            if wait_for(session, markers.step, deadline) is None:
                result.update(verdict='timeout', reason='step marker never printed')
                return result
            for delay, data, label in plan['after_step']:
                if delay:
                    time.sleep(delay / 1000.0)
                session.write(data, label)
        verdict = wait_verdict(session, markers, deadline)
        result['verdict'] = verdict or 'timeout'
        if verdict is None:
            result['reason'] = 'no verdict before the deadline'
        return result
    finally:
        if session is not None:
            session.close()


class _StubSession:
    """A session stand-in for rows that never produced a wire timeline."""

    def __init__(self, text=''):
        self._text = text

    def text(self):
        return self._text


def blockage_evidence(session):
    """The first documented blocking prompt visible on the wire, or None."""
    text = session.text()
    for signature in BLOCKAGE_SIGNATURES:
        if signature in text:
            return signature
    return None


def expected_summary(launch):
    model = LAUNCH_MODELS[launch]
    if model['expectation'] == 'pass':
        return 'pass (' + model['purpose'] + ')'
    return 'fail, blocked in the system rc (' + model['purpose'] + ')'


def observed_summary(result):
    if result.get('diagnostic_error'):
        return 'diagnostic error: ' + result['diagnostic_error']
    if result['verdict'] == 'pass':
        return 'pass marker printed'
    evidence = blockage_evidence(result['session'])
    if evidence:
        return 'blocked in the system rc: ' + evidence
    return result.get('reason') or result['verdict']


def classify(result):
    """One of three classes, never merged.

    A negative control that fails is not a pass, and it is not a product
    failure either: it is an expected failure, and it only counts as expected
    when the observation matches the documented blocking mechanism. Anything
    else is a diagnostic failure, because a test whose premise broke proves
    nothing about the product.
    """
    model = LAUNCH_MODELS[result['launch']]
    if result.get('diagnostic_error'):
        return CLASS_DIAGNOSTIC
    if result['verdict'] == 'pass':
        return CLASS_PASS
    if model['expectation'] == 'fail':
        if blockage_evidence(result['session']):
            return CLASS_EXPECTED
        return CLASS_DIAGNOSTIC
    return CLASS_PRODUCT if model['product'] else CLASS_DIAGNOSTIC


def self_test():
    """Classification-only checks, so the rules can be pinned without a runner."""
    blocked = _StubSession('This is the Z Shell configuration function ... '
                           'zsh-newuser-install')
    quiet = _StubSession('probe> ')

    def row(launch, verdict, session, error=None, reason='no verdict before the deadline'):
        return {'launch': launch, 'verdict': verdict, 'session': session,
                'diagnostic_error': error, 'reason': reason}

    checks = [
        ('bare blocked in the wizard is an expected failure',
         classify(row('bare', 'timeout', blocked)), CLASS_EXPECTED),
        ('bare failing without the documented prompt is a diagnostic failure',
         classify(row('bare', 'timeout', quiet)), CLASS_DIAGNOSTIC),
        ('plain timing out is a product failure',
         classify(row('plain', 'timeout', quiet)), CLASS_PRODUCT),
        ('app timing out is a product failure',
         classify(row('app', 'timeout', quiet)), CLASS_PRODUCT),
        ('plain passing is a pass',
         classify(row('plain', 'pass', quiet)), CLASS_PASS),
        ('app passing is a pass',
         classify(row('app', 'pass', quiet)), CLASS_PASS),
        ('a setup crash is a diagnostic failure',
         classify(row('app', 'timeout', quiet, 'Session start failed')), CLASS_DIAGNOSTIC),
        ('a setup crash is a diagnostic failure even on the control',
         classify(row('bare', 'error', blocked, 'pty.fork failed')), CLASS_DIAGNOSTIC),
    ]
    failures = []
    for name, observed, expected in checks:
        if observed != expected:
            failures.append((name, observed, expected))
    observed_text = observed_summary(row('bare', 'timeout', blocked))
    if 'blocked in the system rc' not in observed_text:
        failures.append(('the observation names the blocking prompt',
                         observed_text, 'blocked in the system rc: ...'))
    expected_text = expected_summary('bare')
    if 'blocked in the system rc' not in expected_text:
        failures.append(('the expectation names the blocking mechanism',
                         expected_text, 'fail, blocked in the system rc (...'))
    if expected_summary('app').startswith('pass') is not True:
        failures.append(('the app model is expected to pass',
                         expected_summary('app'), 'pass (...)'))
    for name, got, want in failures:
        print('SELF-TEST FAIL: ' + name + ' => ' + str(got) + ', expected ' + str(want))
    if failures:
        return 1
    print('SELF-TEST PASS: ' + str(len(checks) + 3) + ' classification checks')
    return 0


def describe(result):
    events, _ = result['session'].snapshot()
    markers = result['markers']
    rows = []
    names = [(markers.ready, 'ready-marker'), (markers.step, 'step-marker'),
             (markers.pass_, 'pass-marker'), (markers.fail, 'fail-marker'),
             (markers.size, 'size-marker')]
    seen = set()
    for at, kind, data in events:
        if kind.startswith('write:'):
            rows.append('    {0:8.1f}ms WRITE  {1:<14} zle={2:<8} {3}'.format(
                at * 1000, kind[6:], zle_state(events, at), fmt(data)))
            probe = data.strip(CR.encode())
            if probe:
                for echo_at, echo_kind, echo_data in events:
                    if echo_kind != 'recv' or echo_at < at or echo_at > at + 1.5:
                        continue
                    if probe in echo_data:
                        rows.append('    {0:8.1f}ms ECHO   {1:<14} after {2}ms'.format(
                            echo_at * 1000, kind[6:], round((echo_at - at) * 1000)))
                        break
        elif kind.startswith('resize:'):
            rows.append('    {0:8.1f}ms RESIZE {1:<15} {2}'.format(
                at * 1000, kind[7:], fmt(data)))
        elif kind.startswith('write-failed:') and data:
            rows.append('    {0:8.1f}ms WRITE-FAILED {1}: {2}'.format(
                at * 1000, kind[13:], fmt(data)))
        elif kind == 'recv':
            for needle, name in names:
                if name in seen or needle.encode() not in data:
                    continue
                seen.add(name)
                rows.append('    {0:8.1f}ms BUFFER received {1}'.format(at * 1000, name))
    if RAW_DUMP_LIMIT:
        raw, _ = result['session'].snapshot()[0], None
        rows.append('    raw: ' + repr(bytes(result['session'].raw))[:RAW_DUMP_LIMIT])
    return rows


def startup_facts(shell, launch, home, wrapper):
    """Options and keymaps from a throwaway child, never the session under test."""
    env = dict(os.environ)
    env.update({'HOME': home, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor'})
    env.pop('TERMINAL_REAL_ZDOTDIR', None)
    argv = [shell]
    if launch == 'app':
        env['ZDOTDIR'] = wrapper
        env['TERMINAL_SHELL_INTEGRATION'] = '1'
    model = LAUNCH_MODELS.get(launch, LAUNCH_MODELS['bare'])
    argv.append('-l' if model['login'] else '-i')
    argv += ['-c', 'echo "ZDOTDIR=["' + DOLLAR + 'ZDOTDIR]"; echo "HOME=["'
             + DOLLAR + 'HOME]"; setopt; bindkey -l']
    try:
        done = subprocess.run(argv, env=env, capture_output=True, timeout=25,
                              text=True, cwd=home)
    except (OSError, subprocess.SubprocessError) as error:
        return 'startup probe failed: {0}'.format(error)
    chosen = [line.strip() for line in done.stdout.splitlines()
              if line.strip().startswith(INTERESTING_OPTIONS + ('ZDOTDIR=', 'HOME='))]
    modes = []
    # bash variants carry no wrapper, so this list can hold None. os.stat(None)
    # raises TypeError, which the OSError guard below does not catch - that is
    # what turned a missing wrapper into a hard process failure on Linux.
    for path in [home, wrapper, os.path.join(wrapper, '.zshrc') if wrapper else None]:
        if not path:
            continue
        try:
            mode = stat.S_IMODE(os.stat(path).st_mode)
            modes.append('{0}=0o{1:o}'.format(os.path.basename(path) or path, mode))
        except (OSError, TypeError):
            pass
    return ' | '.join(chosen) + ' | modes: ' + ', '.join(modes)


def model_preamble(launches):
    """What the run expects, stated before any measurement."""
    lines = ['launch models (expected behaviour, not a result):']
    for launch in launches:
        model = LAUNCH_MODELS[launch]
        lines.append(
            '  {0:<6} expect {1:<4} startup files: {2}'.format(
                launch,
                'pass' if model['expectation'] == 'pass' else 'fail',
                model['startup_files']))
        lines.append('         ' + model['purpose'])
    lines.append('false negatives are failures: a bare-variant timeout only '
                 'counts as expected when the shell is demonstrably blocked '
                 'in the system-wide rc.')
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--shells', default='zsh')
    parser.add_argument('--cases', default=','.join(ALL_CASES))
    parser.add_argument('--launch', default=DEFAULT_LAUNCHES)
    parser.add_argument('--out', default='zsh-diag.log')
    parser.add_argument('--self-test', action='store_true',
                        help='check the classification rules and exit')
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    launches = args.launch.split(',')
    for launch in launches:
        if launch not in LAUNCH_MODELS:
            raise SystemExit('unsupported launch model: ' + launch)
    cases = ALL_CASES if args.cases == 'all' else args.cases.split(',')
    table, details = [], []
    for shell in args.shells.split(','):
        if shutil.which(shell) is None:
            print('SKIP ' + shell + ': not installed', file=sys.stderr)
            continue
        for launch in launches:
            facts = None
            for case in cases:
                try:
                    result = run_case(shell, case, launch)
                except (OSError, subprocess.SubprocessError, ValueError) as error:
                    # The diagnostic itself broke. Reporting that as a timeout
                    # would attribute a harness bug to the product.
                    result = {'case': case, 'launch': launch, 'shell': shell,
                              'session': _StubSession(), 'markers': Markers('diag'),
                              'home': None, 'wrapper': None, 'verdict': 'error',
                              'reason': 'the diagnostic could not start the shell',
                              'resize': None, 'startup_files': [], 'argv': [shell],
                              'zdotdir': None, 'diagnostic_error': str(error)}
                if facts is None and result.get('home'):
                    facts = startup_facts(shell, launch, result['home'], result['wrapper'])
                verdict_class = classify(result)
                rows = describe(result)
                reason = result.get('reason') or ''
                if (LAUNCH_MODELS[launch]['expectation'] == 'fail'
                        and result['verdict'] == 'pass'):
                    # Stated, not hidden: the control proved nothing on this
                    # host, so the blockage is still unmeasured here.
                    reason = 'negative control did not block on this host'
                table.append((shell, launch, case, expected_summary(launch),
                              observed_summary(result), verdict_class, reason))
                extra = ''
                if result['resize']:
                    extra = NL + 'resize: ' + repr(result['resize'])
                details.append(
                    NL + '===== ' + shell + ' / ' + launch + ' / ' + case + ' =====' + NL
                    + 'expected: ' + expected_summary(launch) + NL
                    + 'observed: ' + observed_summary(result) + NL
                    + 'class: ' + verdict_class + NL
                    + 'argv: ' + repr(result.get('argv')) + ' ZDOTDIR='
                    + repr(result.get('zdotdir')) + ' startup files: '
                    + repr(result.get('startup_files')) + NL
                    + 'verdict: ' + result['verdict'] + ' ('
                    + (result['reason'] or 'ok') + ')' + NL
                    + NL.join(rows) + extra + NL + 'startup: ' + (facts or 'n/a')
                )
                for path in (result['home'], result['wrapper']):
                    if path:
                        shutil.rmtree(path, ignore_errors=True)

    header = ['shell | launch | case | expected | observed | class | reason',
              '--- | --- | --- | --- | --- | --- | ---']
    lines = model_preamble(launches) + [''] + header
    for row in table:
        lines.append('{0} | {1} | {2} | {3} | {4} | {5} | {6}'.format(*row))
    counts = {}
    for row in table:
        counts[row[5]] = counts.get(row[5], 0) + 1
    lines.append('')
    lines.append('classes: ' + ', '.join(
        '{0}={1}'.format(name, counts[name]) for name in sorted(counts)))
    print(NL.join(lines))
    with open(args.out, 'w', encoding='utf-8') as handle:
        handle.write(NL.join(lines) + NL)
        handle.write(NL.join(details) + NL)
    print()
    print('timelines written to ' + args.out)
    return 1 if any(row[5] in FAILING_CLASSES for row in table) else 0


if __name__ == '__main__':
    raise SystemExit(main())
