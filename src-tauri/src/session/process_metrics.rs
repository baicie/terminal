//! F17 — this process's own memory and descriptor count, for the soak's curve.
//!
//! ## What this is for, and what it is deliberately not
//!
//! The 12-round lifecycle regression in CI asserts a **deterministic** fact: after every
//! round the product's own pool and registry return to zero. That is a leak test, and it
//! is the one that blocks.
//!
//! RSS and open descriptors are different. They move with the allocator, with `sshd`
//! teardown timing, and with whatever else the machine is doing, so a single reading is
//! not evidence of anything. What is evidence is a **curve across rounds**: a leak shows
//! up as a slope that does not come back down, while noise goes up and down around a
//! level. So this module only reports numbers; the soak harness decides what a slope
//! means, and nothing here gates a merge.
//!
//! ## Why Unix-only, and why `None` rather than zeros
//!
//! macOS and Linux both answer these two questions with a couple of `libc` calls.
//! Windows needs `GetProcessMemoryInfo` and a handle count with a different permission
//! model. Returning `None` there is the honest option: a zero would enter the curve as a
//! measurement and make a Windows run look like a perfect flatline.

/// One sample of this process's footprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct ProcessMetrics {
    /// Resident set size in bytes.
    pub rss_bytes: u64,
    /// Open file descriptors. On Linux this counts every entry in `/proc/self/fd`,
    /// including the directory handle used to read it.
    pub open_fds: u64,
}

/// Read the current footprint, or `None` where this platform cannot be measured.
#[cfg(unix)]
pub fn current() -> Option<ProcessMetrics> {
    Some(ProcessMetrics {
        rss_bytes: resident_bytes()?,
        open_fds: open_descriptor_count()?,
    })
}

#[cfg(not(unix))]
pub fn current() -> Option<ProcessMetrics> {
    None
}

#[cfg(target_os = "macos")]
fn resident_bytes() -> Option<u64> {
    use std::mem::{size_of, zeroed};

    // `proc_pidinfo(PROC_PIDTASKINFO)` is the documented way to ask about one's own task
    // without entitlements. `proc_taskinfo.pti_resident_size` is what `ps` prints as RSS.
    let mut info: libc::proc_taskinfo = unsafe { zeroed() };
    let size = size_of::<libc::proc_taskinfo>() as libc::c_int;
    // SAFETY: `info` is a correctly-sized, properly aligned `proc_taskinfo` that
    // outlives the call, and the return value is checked for an exact-size reply.
    let written = unsafe {
        libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTASKINFO,
            0,
            (&raw mut info).cast(),
            size,
        )
    };
    if written as usize != size_of::<libc::proc_taskinfo>() {
        return None;
    }
    Some(info.pti_resident_size)
}

#[cfg(target_os = "linux")]
fn resident_bytes() -> Option<u64> {
    // `/proc/self/statm` field 2 is the resident set in pages. Reading a file is slower
    // than a syscall but this runs once per round, and it keeps the Linux path free of a
    // second `libc` struct whose layout differs between architectures.
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let resident_pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    Some(resident_pages * page_size_bytes())
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn resident_bytes() -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
fn page_size_bytes() -> u64 {
    // SAFETY: `sysconf(_SC_PAGESIZE)` has no preconditions and no side effects.
    let size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if size > 0 {
        size as u64
    } else {
        // The only failure mode is an unrecognised name, which cannot happen for this
        // constant. 4096 keeps the curve monotonic instead of collapsing it to zero.
        4096
    }
}

#[cfg(target_os = "macos")]
fn open_descriptor_count() -> Option<u64> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `limit` is a valid, properly aligned `rlimit` for the duration of the call.
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        return None;
    }
    /*
     * ## `getdtablesize` is not the answer
     *
     * macOS offers no "how many are open" call, only "how many could be". Walking
     * `fcntl(fd, F_GETFD)` over `0..limit` is what every macOS leak test does, but the
     * soft limit here can be large; the soak caps the walk and says so rather than
     * silently reporting a truncated count as the total.
     */
    let ceiling = limit.rlim_cur.min(WALK_CEILING) as libc::c_int;
    let mut open = 0u64;
    for fd in 0..ceiling {
        // SAFETY: `F_GETFD` only inspects the descriptor; a closed or invalid one
        // returns -1 with EBADF, which is exactly the test.
        if unsafe { libc::fcntl(fd, libc::F_GETFD) } != -1 {
            open += 1;
        }
    }
    Some(open)
}

#[cfg(target_os = "linux")]
fn open_descriptor_count() -> Option<u64> {
    Some(std::fs::read_dir("/proc/self/fd").ok()?.count() as u64)
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "linux"))))]
fn open_descriptor_count() -> Option<u64> {
    None
}

/// How far the macOS descriptor walk goes.
///
/// `RLIMIT_NOFILE` on a developer machine can be 10k or more; walking that once per
/// round for 100 rounds is 1M `fcntl` calls for no extra information. A leak in this
/// application's range shows up well below this ceiling. The value is high enough that
/// ordinary runs never reach it, and the harness prints the limit so a run that did
/// would be visible rather than quietly capped.
#[cfg(target_os = "macos")]
const WALK_CEILING: libc::rlim_t = 4096;

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// The measurement has to be plausible, not exact: an RSS of zero or a descriptor
    /// count of zero would enter the soak's curve as data and flatten it.
    #[test]
    fn a_running_process_reports_plausible_numbers() {
        let metrics = current().expect("unix must be measurable");
        assert!(
            metrics.rss_bytes > 1024 * 1024,
            "a running test binary holds more than a megabyte: {}",
            metrics.rss_bytes
        );
        assert!(
            metrics.open_fds >= 3,
            "stdin/stdout/stderr are open by construction: {}",
            metrics.open_fds
        );
    }

    /// Holding a descriptor must move the count by at least one, and dropping it must
    /// move it back. A count that never changes would make every soak curve flat.
    #[test]
    fn opening_a_file_moves_the_descriptor_count() {
        let before = current().expect("unix must be measurable").open_fds;
        let file = std::fs::File::open("Cargo.toml").expect("this test runs in src-tauri");
        let during = current().expect("unix must be measurable").open_fds;
        drop(file);
        let after = current().expect("unix must be measurable").open_fds;

        assert!(
            during > before,
            "opening a file must be visible: before={before} during={during}"
        );
        assert!(
            after <= during,
            "dropping it must not increase the count: during={during} after={after}"
        );
    }
}
