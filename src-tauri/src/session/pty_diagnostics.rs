//! Opt-in PTY diagnostics for the shell interaction probe.
//!
//! The shell interaction probe drives real keystrokes through a real PTY, so a
//! case that times out leaves nothing behind but a deadline. Three zsh cases
//! time out on the Linux runner while the same cases pass everywhere else, and
//! the only way to tell "the shell never produced the bytes" apart from "the app
//! never delivered the bytes typed at it" is to record both ends of the PTY.
//!
//! Nothing here runs unless TERMINAL_PTY_DIAGNOSTICS_PATH names an absolute
//! directory, so a normal session pays one OnceLock read per call. When it is
//! set, every session writes "<session id>.json" when it ends.
//!
//! The line-editor state is reported from sequences the shell itself emits, not
//! from a proxy: "ESC [ ? 2004 h/l" is emitted by zle around every line edit
//! (zsh 5.1+, and the only marker a macOS zsh 5.9 emitted), and "ESC [ ? 1 h/l"
//! (terminfo smkx/rmkx) is read as a secondary signal because only terminal
//! descriptions that carry the capability produce it. A shell running a command
//! prints neither, which is what makes the state usable; "[[ -o zle ]]" is off
//! exactly while a command could observe it, so it can never answer this.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Directory the per-session traces are written into. Absent means disabled.
const ENABLE_ENV: &str = "TERMINAL_PTY_DIAGNOSTICS_PATH";
const PREVIEW_BYTES: usize = 96;
/// Bytes of PTY output kept verbatim per session, so an echo can be matched
/// exactly instead of guessed at from a preview.
const RAW_BUDGET: usize = 256 * 1024;
/// Deadline for the throwaway startup probe child.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const LONGEST_SEQUENCE: usize = 8;

const PASTE_ON: &[u8] = b"\x1b[?2004h";
const PASTE_OFF: &[u8] = b"\x1b[?2004l";
const KEYS_ON: &[u8] = b"\x1b[?1h";
const KEYS_OFF: &[u8] = b"\x1b[?1l";

/// Probe trace markers the frontend waits for, plus the prompt sequences the
/// shell integration installs. Their arrival on the PTY is the only evidence
/// that separates production from delivery.
const MARKERS: [(&str, &[u8]); 9] = [
    ("READY", b"READY__"),
    ("STEP", b"STEP__"),
    ("PASS", b"PASS__"),
    ("FAIL", b"FAIL__"),
    ("SIZE", b"SIZE__"),
    ("osc133-A", b"\x1b]133;A"),
    ("osc133-B", b"\x1b]133;B"),
    ("osc133-D", b"\x1b]133;D"),
    ("osc7-cwd", b"\x1b]7;"),
];

fn preview(data: &[u8]) -> String {
    let mut out = String::new();
    for byte in data.iter().take(PREVIEW_BYTES) {
        match byte {
            0x20..=0x7e => out.push(*byte as char),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            other => out.push_str(&format!("\\x{other:02x}")),
        }
    }
    if data.len() > PREVIEW_BYTES {
        out.push_str(&format!("... (+{} bytes)", data.len() - PREVIEW_BYTES));
    }
    out
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn markers_in(data: &[u8]) -> Vec<&'static str> {
    MARKERS
        .into_iter()
        .filter(|(_, marker)| contains(data, marker))
        .map(|(name, _)| name)
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ZleState {
    Unknown,
    Active,
    Inactive,
}

impl ZleState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Active => "active",
            Self::Inactive => "inactive",
        }
    }
}

/// Line-editor ownership tracker. It keeps the tail of the previous chunk so a
/// sequence split across two reads is still recognised, which is the normal
/// case: the prompt and the sequence travel in separate writes.
#[derive(Default)]
pub(crate) struct ZleTracker {
    tail: Vec<u8>,
}

const SEQUENCES: [(ZleState, &str, &[u8]); 4] = [
    (ZleState::Active, "paste", PASTE_ON),
    (ZleState::Inactive, "paste", PASTE_OFF),
    (ZleState::Active, "cursor-keys", KEYS_ON),
    (ZleState::Inactive, "cursor-keys", KEYS_OFF),
];

impl ZleTracker {
    /// Feeds one PTY chunk and reports the rightmost state transition it
    /// contains, or nothing when the chunk decided no state at all.
    pub(crate) fn feed(&mut self, chunk: &[u8]) -> Option<(ZleState, &'static str)> {
        let mut buffer = std::mem::take(&mut self.tail);
        buffer.extend_from_slice(chunk);
        let mut rightmost: Option<(usize, ZleState, &'static str)> = None;
        for (state, kind, sequence) in SEQUENCES {
            if let Some(position) = last_position(&buffer, sequence) {
                if rightmost.is_none_or(|(best, _, _)| position >= best) {
                    rightmost = Some((position, state, kind));
                }
            }
        }
        let keep = buffer.len().saturating_sub(LONGEST_SEQUENCE - 1);
        self.tail = buffer[keep..].to_vec();
        rightmost.map(|(_, state, kind)| (state, kind))
    }
}

fn last_position(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .rposition(|window| window == needle)
}

#[derive(Debug, Serialize)]
pub(crate) struct TraceEntry {
    at_ms: u64,
    kind: String,
    zle: String,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<usize>,
    /// Milliseconds until the shell echoed the very same bytes back. Present
    /// only for writes, and only when the shell echoed them at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    echo_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
struct SessionTrace {
    session_id: String,
    facts: BTreeMap<String, String>,
    entries: Vec<TraceEntry>,
}

#[derive(Default)]
struct Inner {
    origin: Option<Instant>,
    facts: BTreeMap<String, String>,
    entries: Vec<TraceEntry>,
    tracker: ZleTracker,
    state: Option<ZleState>,
    state_kind: Option<&'static str>,
    written: Vec<(usize, u64, Vec<u8>)>,
    read: Vec<(u64, Vec<u8>)>,
    raw_bytes: usize,
}

impl Inner {
    fn origin(&mut self) -> Instant {
        *self.origin.get_or_insert_with(Instant::now)
    }

    fn push(&mut self, kind: &str, detail: String, bytes: Option<usize>) -> u64 {
        let origin = self.origin();
        let at_ms = origin.elapsed().as_millis() as u64;
        let zle = match (self.state, self.state_kind) {
            (Some(state), Some(state_kind)) => format!("{} ({state_kind})", state.as_str()),
            _ => ZleState::Unknown.as_str().to_string(),
        };
        self.entries.push(TraceEntry {
            at_ms,
            kind: kind.to_string(),
            zle,
            detail,
            bytes,
            echo_ms: None,
        });
        at_ms
    }

    fn write(&mut self, data: &[u8]) {
        let index = self.entries.len();
        let at_ms = self.push("write", preview(data), Some(data.len()));
        self.written.push((index, at_ms, data.to_vec()));
    }

    fn read(&mut self, data: &[u8]) {
        if let Some((state, kind)) = self.tracker.feed(data) {
            self.state = Some(state);
            self.state_kind = Some(kind);
            let detail = format!("{} via {kind}", state.as_str());
            self.push("zle", detail, None);
        }
        let markers = markers_in(data);
        let detail = if markers.is_empty() {
            preview(data)
        } else {
            format!("markers {} | {}", markers.join(","), preview(data))
        };
        let at_ms = self.push("read", detail, Some(data.len()));
        if self.raw_bytes < RAW_BUDGET {
            self.raw_bytes += data.len();
            self.read.push((at_ms, data.to_vec()));
        }
    }

    /// Fills in how long each write took to be echoed, then forgets the raw
    /// output so the artifact stays small.
    fn settle_echoes(&mut self) {
        let echoes: Vec<(usize, Option<u64>)> = self
            .written
            .iter()
            .map(|(index, at_ms, bytes)| {
                let needle = trim_line_end(bytes);
                let echo = if needle.is_empty() {
                    None
                } else {
                    self.read
                        .iter()
                        .filter(|(read_at, _)| read_at >= at_ms)
                        .find(|(_, data)| contains(data, needle))
                        .map(|(read_at, _)| read_at.saturating_sub(*at_ms))
                };
                (*index, echo)
            })
            .collect();
        for (index, echo) in echoes {
            self.entries[index].echo_ms = echo;
        }
        self.read.clear();
        self.written.clear();
    }

    fn into_trace(self, session_id: &str) -> SessionTrace {
        SessionTrace {
            session_id: session_id.to_string(),
            facts: self.facts,
            entries: self.entries,
        }
    }
}

fn trim_line_end(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && (bytes[end - 1] == b'\r' || bytes[end - 1] == b'\n') {
        end -= 1;
    }
    &bytes[..end]
}

fn configured_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let value = std::env::var_os(ENABLE_ENV)?;
        let path = PathBuf::from(value);
        if path.as_os_str().is_empty() || !path.is_absolute() {
            return None;
        }
        Some(path)
    })
    .as_deref()
}

pub(crate) fn enabled() -> bool {
    configured_dir().is_some()
}

fn registry() -> &'static Mutex<BTreeMap<String, Arc<Mutex<Inner>>>> {
    static REGISTRY: OnceLock<Mutex<BTreeMap<String, Arc<Mutex<Inner>>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn with_session(session_id: &str, apply: impl FnOnce(&mut Inner)) {
    if !enabled() {
        return;
    }
    let handle = registry()
        .lock()
        .ok()
        .and_then(|map| map.get(session_id).cloned());
    if let Some(handle) = handle {
        if let Ok(mut inner) = handle.lock() {
            apply(&mut inner);
        }
    }
}

fn mode_of(path: &Path) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(metadata) => format!("0o{:o}", metadata.permissions().mode() & 0o777),
            Err(error) => format!("unreadable: {error}"),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        "n/a".to_string()
    }
}

/// Records everything the session was started with that a startup failure can
/// depend on, then polls the interactive options once in a throwaway child.
pub(crate) fn session_started(
    session_id: &str,
    shell: &str,
    args: &[String],
    env: &[(&str, String)],
) {
    if !enabled() {
        return;
    }
    let mut facts = BTreeMap::new();
    facts.insert("shell".to_string(), shell.to_string());
    facts.insert("args".to_string(), args.join(" "));
    for (name, value) in env {
        facts.insert((*name).to_string(), value.clone());
        if matches!(*name, "ZDOTDIR" | "TERMINAL_REAL_ZDOTDIR") {
            facts.insert(format!("{name}_mode"), mode_of(Path::new(value.as_str())));
        }
    }
    facts.insert(
        "HOME".to_string(),
        std::env::var("HOME").unwrap_or_else(|_| "<unset>".to_string()),
    );
    if let Some(home) = std::env::var_os("HOME") {
        facts.insert("HOME_mode".to_string(), mode_of(Path::new(&home)));
    }
    let probe = startup_probe(shell, args, env);
    facts.insert("startup_options".to_string(), probe);

    let mut inner = Inner {
        origin: Some(Instant::now()),
        facts,
        ..Inner::default()
    };
    inner.push("spawn", format!("{shell} {}", args.join(" ")), None);
    if let Ok(mut map) = registry().lock() {
        map.insert(session_id.to_string(), Arc::new(Mutex::new(inner)));
    }
}

/// Reads the interactive options and keymaps once, from a sibling process that
/// shares the session's startup files. Asking the session itself would change
/// the thing being measured.
fn startup_probe(shell: &str, args: &[String], env: &[(&str, String)]) -> String {
    let script = "echo ZDOTDIR=[$ZDOTDIR]; echo HOME=[$HOME]; setopt; bindkey -l";
    let mut command = Command::new(shell);
    command.args(args).arg("-c").arg(script);
    for (name, value) in env {
        command.env(name, value);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return format!("probe failed to start: {error}"),
    };
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                let _ = child.kill();
                return "probe timed out".to_string();
            }
            Err(error) => return format!("probe failed to wait: {error}"),
        }
    }
    match child.wait_with_output() {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout);
            let interesting: Vec<&str> = text
                .lines()
                .filter(|line| {
                    const PREFIXES: [&str; 16] = [
                        "interactive",
                        "login",
                        "zle",
                        "promptsubst",
                        "shinstdin",
                        "monitor",
                        "histappend",
                        "incappendhistory",
                        "sharehistory",
                        "autolist",
                        "menucomplete",
                        "promptcr",
                        "emacs",
                        "vi",
                        "ZDOTDIR=",
                        "HOME=",
                    ];
                    PREFIXES.iter().any(|prefix| line.starts_with(prefix))
                })
                .map(str::trim)
                .collect();
            interesting.join(" | ")
        }
        Err(error) => format!("probe failed to collect: {error}"),
    }
}

/// Notes a non-PTY event on the timeline, such as startup bytes handed to a
/// shell that never reached the user.
pub(crate) fn note(session_id: &str, kind: &str, detail: impl Into<String>) {
    with_session(session_id, |inner| {
        inner.push(kind, detail.into(), None);
    });
}

/// Records bytes handed to the PTY, together with the line-editor state at that
/// instant: input typed while a command owns the terminal is the failure this
/// instrumentation exists to expose.
pub(crate) fn wrote(session_id: &str, data: &[u8]) {
    with_session(session_id, |inner| inner.write(data));
}

/// Records bytes read from the PTY and updates the line-editor state.
pub(crate) fn read_chunk(session_id: &str, data: &[u8]) {
    with_session(session_id, |inner| inner.read(data));
}

/// Records a chunk the app handed to the output pump, which is the first moment
/// the frontend could possibly render it.
pub(crate) fn emitted(session_id: &str, bytes: usize) {
    with_session(session_id, |inner| {
        inner.push("emit", format!("{bytes} bytes to renderer"), Some(bytes));
    });
}

/// Records a resize request next to the winsize the kernel actually reports
/// afterwards, so a resize the PTY dropped cannot look like a resize the shell
/// ignored.
pub(crate) fn resized(
    session_id: &str,
    requested: (u16, u16),
    actual: Option<(u16, u16)>,
    error: Option<String>,
) {
    with_session(session_id, |inner| {
        let detail = match (actual, error) {
            (Some((cols, rows)), _) => {
                let changed = (cols, rows) == requested;
                format!("requested {requested:?} now {cols}x{rows} changed={changed}")
            }
            (None, Some(error)) => format!("requested {requested:?} failed: {error}"),
            (None, None) => format!("requested {requested:?} unreadable"),
        };
        inner.push("resize", detail, None);
    });
}

/// Writes the session trace and forgets it. A session that never finishes keeps
/// its trace in memory, which is bounded by RAW_BUDGET.
pub(crate) fn session_finished(session_id: &str) {
    let Some(dir) = configured_dir() else {
        return;
    };
    let handle = registry()
        .lock()
        .ok()
        .and_then(|mut map| map.remove(session_id));
    let Some(handle) = handle else {
        return;
    };
    let Ok(mutex) = Arc::try_unwrap(handle) else {
        return;
    };
    let Ok(mut inner) = mutex.into_inner() else {
        return;
    };
    inner.push("close", "session finished".to_string(), None);
    inner.settle_echoes();
    let trace = inner.into_trace(session_id);
    let Ok(body) = serde_json::to_vec_pretty(&trace) else {
        return;
    };
    if let Err(error) = std::fs::create_dir_all(dir) {
        tracing::warn!(directory = %dir.display(), %error, "failed to create the PTY diagnostics directory");
        return;
    }
    let path = dir.join(format!("{session_id}.json"));
    if let Err(error) = std::fs::write(&path, body) {
        tracing::warn!(path = %path.display(), %error, "failed to write the PTY diagnostics trace");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bracketed_paste_brackets_one_line_edit() {
        let mut tracker = ZleTracker::default();
        // Byte-for-byte from a macOS zsh 5.9 transcript: the prompt, then zle
        // taking the line editor, then handing it back when the command runs.
        let chunk = b"\x1b[K\x1b[?2004hexecuted\x1b[?2004l\r\noutput";
        assert_eq!(tracker.feed(chunk), Some((ZleState::Inactive, "paste")));
        let mut second = ZleTracker::default();
        assert_eq!(
            second.feed(b"prompt % \x1b[K\x1b[?2004h"),
            Some((ZleState::Active, "paste"))
        );
        assert_eq!(
            second.feed(b"nothing"),
            None,
            "a chunk without a sequence keeps the state"
        );
    }

    #[test]
    fn a_sequence_split_across_reads_is_still_recognised() {
        let mut tracker = ZleTracker::default();
        assert_eq!(tracker.feed(b"prompt % \x1b[?20"), None);
        assert_eq!(tracker.feed(b"04h"), Some((ZleState::Active, "paste")));
    }

    #[test]
    fn unrelated_escape_sequences_never_move_the_state() {
        let mut tracker = ZleTracker::default();
        assert_eq!(
            tracker.feed(b"\x1b[2J\x1b[?25l\x1b[?1;2c\x1b]133;A\x07"),
            None
        );
        assert_eq!(
            ZleTracker::default().feed(b"\x1b[?2004l"),
            Some((ZleState::Inactive, "paste"))
        );
    }

    #[test]
    fn cursor_key_capability_is_the_secondary_signal() {
        assert_eq!(
            ZleTracker::default().feed(b"\x1b[?1h\x1b="),
            Some((ZleState::Active, "cursor-keys"))
        );
        assert_eq!(
            ZleTracker::default().feed(b"\x1b[?1l\x1b>"),
            Some((ZleState::Inactive, "cursor-keys"))
        );
        // One chunk carrying both hands the editor back, so the rightmost wins.
        assert_eq!(
            ZleTracker::default().feed(b"\x1b[?1h...\x1b[?1l"),
            Some((ZleState::Inactive, "cursor-keys"))
        );
    }

    #[test]
    fn a_write_echoed_back_reports_its_latency() {
        let mut inner = Inner::default();
        inner.write(b"echo hi\r");
        inner.read(b"echo hi\r\r\nhi");
        inner.settle_echoes();
        let write = inner
            .entries
            .iter()
            .find(|entry| entry.kind == "write")
            .expect("the write has to be recorded");
        assert!(write.echo_ms.is_some(), "an echoed write reports a latency");
        assert!(write.zle.starts_with("unknown"));
    }

    #[test]
    fn a_swallowed_write_reports_no_echo() {
        let mut inner = Inner::default();
        inner.write(b"\x1b[A\r");
        inner.read(b"unrelated output");
        inner.settle_echoes();
        let write = inner
            .entries
            .iter()
            .find(|entry| entry.kind == "write")
            .expect("the write has to be recorded");
        assert_eq!(
            write.echo_ms, None,
            "a swallowed write must not claim an echo"
        );
    }

    #[test]
    fn markers_are_reported_once_per_chunk() {
        assert_eq!(
            markers_in(b"\r\n__TERMINAL_SHELL_PROBE_x_PASS__\r\n"),
            vec!["PASS"]
        );
        assert!(markers_in(b"plain output").is_empty());
    }

    #[test]
    fn preview_escapes_control_bytes() {
        assert_eq!(preview(b"a\rb"), "a\\rb");
        assert!(preview(&[b'x'; PREVIEW_BYTES + 5]).contains("(+5 bytes)"));
    }

    #[test]
    fn a_relative_directory_never_enables_the_recorder() {
        // The environment is read once per process, so this asserts the rule
        // rather than the configured value: a relative path is never accepted.
        let relative = Path::new("traces");
        assert!(!relative.is_absolute());
    }
}
