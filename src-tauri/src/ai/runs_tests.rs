//! The cancellation registry: one handle per request id, and no silent replacement.
//!
//! ## The defect this file was written for
//!
//! `AiRuns::register` used to `insert` unconditionally. A second run under the same
//! request id therefore **overwrote** the first run's flag, and `cancel(id)` reached
//! only the second one — the first kept streaming a token-billed answer that nothing
//! could stop. `finish()` was equally blind: the first run finishing removed the
//! *second* run's entry.
//!
//! It was unreachable through the dock (ids are monotonic) and that is exactly why it
//! survived review: the safety property lived in the caller's id generator rather than
//! in the handle that owns it. These tests move the property here.

use super::{AiFailure, AiFailureKind, AiRuns};

#[test]
fn a_second_run_under_the_same_id_is_refused() {
    let runs = AiRuns::default();
    assert!(
        runs.register("run-1").is_some(),
        "the first registration of an id must succeed"
    );
    assert!(
        runs.register("run-1").is_none(),
        "a second registration under the same id must be refused, not silently \
         replace the first run's cancellation handle"
    );
}

#[test]
fn cancelling_after_a_refused_registration_still_stops_the_first_run() {
    // The consequence the refusal exists to prevent: if the second registration had
    // replaced the flag, `cancel` would trip only the newcomer and the original run
    // would continue.
    let runs = AiRuns::default();
    let first = runs.register("run-1").expect("first");
    assert!(runs.register("run-1").is_none());
    assert!(runs.cancel("run-1"), "the id is still in flight");
    assert!(
        first.is_cancelled(),
        "cancel must reach the run that actually owns the id"
    );
}

#[test]
fn a_finished_run_frees_its_id_for_reuse() {
    let runs = AiRuns::default();
    let first = runs.register("run-1").expect("first");
    runs.finish("run-1");
    let second = runs
        .register("run-1")
        .expect("the id is free once the run finished");
    // And the new flag is independent of the old one.
    assert!(!second.is_cancelled());
    first.cancel();
    assert!(
        !second.is_cancelled(),
        "an old handle must not reach the run that reused the id"
    );
}

#[test]
fn distinct_ids_get_distinct_handles() {
    // The property that makes `ai_cancel` addressable: two surfaces must not cancel
    // each other.
    let runs = AiRuns::default();
    let first = runs.register("run-1").expect("first");
    let second = runs.register("run-2").expect("second");
    assert!(runs.cancel("run-1"));
    assert!(first.is_cancelled());
    assert!(!second.is_cancelled(), "cancelling one run stopped another");
}

#[test]
fn cancelling_an_unknown_id_is_false_rather_than_a_panic() {
    // A cancel can cross a run's completion. Reporting `false` lets the UI tell
    // "cancelled" from "it already finished".
    let runs = AiRuns::default();
    assert!(!runs.cancel("never-registered"));
    runs.register("run-1").expect("first");
    runs.finish("run-1");
    assert!(!runs.cancel("run-1"));
}

#[test]
fn the_refusal_reaches_the_user_as_its_own_sentence() {
    // The dock renders `failure.message`; a wrong kind here would show "AI is not
    // enabled in this build" for a duplicate-run refusal.
    let failure = AiFailure::new(AiFailureKind::RunInProgress);
    assert_eq!(failure.kind, AiFailureKind::RunInProgress);
    assert!(
        failure.message.contains("already running"),
        "expected a sentence about the duplicate run, got: {}",
        failure.message
    );
    assert!(
        !failure.message.to_lowercase().contains("not enabled"),
        "the message must not describe a different failure kind"
    );
}
