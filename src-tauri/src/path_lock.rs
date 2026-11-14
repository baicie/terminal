//! Per-path serialisation with a self-pruning registry.
//!
//! Both transfer directions need the same thing: **one mutex per destination path,
//! alive exactly as long as somebody is holding or waiting on it, and no entry left
//! behind for a path nobody uses any more.** The upload side wrote this first
//! (issue #52) and the download commit needs it too (issue #75). Duplicating it
//! would mean duplicating the two defects it exists to avoid, so it lives here and
//! each direction owns a registry instance.
//!
//! ## The two failures this has to avoid at once
//!
//! **Losing mutual exclusion.** An entry must not be forgotten while any caller
//! still holds or is waiting on that path's mutex. Forgetting it lets the next
//! caller build a *fresh* mutex for the same path, and two operations then
//! interleave the very steps the lock exists to serialise.
//!
//! **Growing without bound.** Every path that ever ran used to leave its entry
//! behind forever. Measured on the upload side before the fix: 200 sequential
//! uploads to distinct paths left 203 entries. A long-running app accumulates one
//! per file it has ever touched.
//!
//! ## Why the old check never fired
//!
//! The first version read `Arc::strong_count(&lock) == 2` after taking the guard. At
//! that moment there are always **three** strong references — the registry's, the
//! local binding, and the one the `OwnedMutexGuard` holds. Measured with a probe:
//! the value is 3, always. The branch was dead code, which is why the registry only
//! ever grew.
//!
//! ## Why a `Weak` registry
//!
//! Storing `Weak<Mutex>` makes the two requirements the same requirement. The
//! registry does not keep the mutex alive; the callers do. So:
//!
//!   * a mutex disappears exactly when its last holder finishes — no counter to get
//!     wrong, no threshold to tune;
//!   * every caller that *is* holding or waiting on it holds a strong reference, so
//!     the mutex cannot vanish underneath them;
//!   * the map still needs pruning of dead keys, which happens on each call.
//!
//! That is the whole mechanism. It is not a threshold on a reference count; it is
//! the language's own ownership rule doing the work.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// One registry, one namespace of path keys.
///
/// Separate instances for uploads and downloads on purpose: an upload locks a
/// *remote* path and a download locks a *local* one, so the two key spaces describe
/// different things even when the strings look alike. Sharing a registry would make
/// an upload to `/home/u/report.pdf` block a download to a local `/home/u/report.pdf`
/// for no reason.
pub(crate) struct PathLockRegistry {
    locks: OnceLock<StdMutex<HashMap<String, Weak<AsyncMutex<()>>>>>,
}

impl PathLockRegistry {
    pub(crate) const fn new() -> Self {
        Self {
            locks: OnceLock::new(),
        }
    }

    fn map(&self) -> &StdMutex<HashMap<String, Weak<AsyncMutex<()>>>> {
        self.locks.get_or_init(|| StdMutex::new(HashMap::new()))
    }

    /// Take this path's mutex, waiting for whoever holds it.
    ///
    /// The strong reference travels with the returned future and then with the
    /// guard, so the mutex stays alive for as long as anyone is waiting on it.
    pub(crate) async fn acquire(&self, key: &str) -> OwnedMutexGuard<()> {
        let mutex = {
            let mut locks = self.map().lock().expect("path lock registry");
            // Drop any entry whose mutex no longer exists, then take or create ours.
            // Pruning happens here rather than on a timer: the only time a dead key
            // can appear is between one holder finishing and the next arriving.
            locks.retain(|_, weak| weak.strong_count() > 0);
            match locks.get(key).and_then(Weak::upgrade) {
                Some(existing) => existing,
                None => {
                    let fresh = Arc::new(AsyncMutex::new(()));
                    locks.insert(key.to_string(), Arc::downgrade(&fresh));
                    fresh
                }
            }
        };
        mutex.lock_owned().await
    }

    /// How many entries the registry holds. Tests measure growth with this.
    #[cfg(test)]
    pub(crate) fn tracked(&self) -> usize {
        self.map().lock().expect("path lock registry").len()
    }

    /// Is there a live entry for this exact key? Tests assert it survives while a
    /// caller is queued on it.
    #[cfg(test)]
    pub(crate) fn is_registered(&self, key: &str) -> bool {
        self.map()
            .lock()
            .expect("path lock registry")
            .get(key)
            .is_some_and(|weak| weak.strong_count() > 0)
    }
}
