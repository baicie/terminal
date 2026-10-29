use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Mutex};

#[test]
fn decoder_preserves_unicode_across_every_byte_boundary() {
    let expected = "plain 中文🙂 fin";
    for split_at in 0..=expected.len() {
        let mut decoder = Utf8StreamDecoder::default();
        let mut actual = decoder.push(&expected.as_bytes()[..split_at]);
        actual.push_str(&decoder.push(&expected.as_bytes()[split_at..]));
        actual.push_str(&decoder.finish());
        assert_eq!(actual, expected, "split at byte {split_at}");
    }
}

#[test]
fn decoder_flushes_an_incomplete_tail_only_at_eof() {
    let mut decoder = Utf8StreamDecoder::default();
    assert_eq!(decoder.push(&[0xf0, 0x9f, 0x99]), "");
    assert_eq!(decoder.finish(), "\u{fffd}");
}

#[test]
fn batcher_keeps_stdout_and_stderr_utf8_decoder_state_independent() {
    let mut batcher = TerminalOutputBatcher::new(OUTPUT_MAX_BATCH_BYTES);
    let mut emitted = Vec::new();
    let mut capture = |output| {
        emitted.push(output);
        Ok(())
    };

    batcher
        .push(TerminalOutputChunk::new(&[0xe4], false), &mut capture)
        .expect("stdout prefix should be accepted");
    batcher
        .push(TerminalOutputChunk::new(b"!", true), &mut capture)
        .expect("stderr should be accepted");
    batcher
        .push(TerminalOutputChunk::new(&[0xb8, 0xad], false), &mut capture)
        .expect("stdout suffix should be accepted");
    batcher.finish(&mut capture).expect("batcher should flush");

    assert_eq!(
        emitted,
        vec![
            DecodedTerminalOutput {
                data: "!".to_string(),
                is_stderr: true,
            },
            DecodedTerminalOutput {
                data: "中".to_string(),
                is_stderr: false,
            },
        ]
    );
}

#[tokio::test]
async fn pump_flushes_after_interval_and_at_eof() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, handle) = spawn_terminal_output_pump(
        Duration::from_millis(16),
        OUTPUT_MAX_BATCH_BYTES,
        2,
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );

    sender
        .send(TerminalOutputChunk::new("中".as_bytes(), false))
        .await
        .expect("queue should accept output");
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert_eq!(emitted.lock().expect("capture mutex").len(), 1);

    sender
        .send(TerminalOutputChunk::new(&[0xf0, 0x9f, 0x99], false))
        .await
        .expect("queue should accept incomplete output");
    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("pump ok");

    let outputs = emitted.lock().expect("capture mutex");
    assert_eq!(outputs[0].data, "中");
    assert_eq!(outputs[1].data, "\u{fffd}");
}

#[tokio::test]
async fn pump_flushes_at_byte_limit_without_reordering() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, handle) =
        spawn_terminal_output_pump(Duration::from_secs(60), 4, 2, move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        });

    sender
        .send(TerminalOutputChunk::new(b"abcdef", false))
        .await
        .expect("queue should accept output");
    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("pump ok");

    let data = emitted
        .lock()
        .expect("capture mutex")
        .iter()
        .map(|output| output.data.as_str())
        .collect::<String>();
    assert_eq!(data, "abcdef");
    assert_eq!(emitted.lock().expect("capture mutex").len(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn bounded_queue_backpressures_instead_of_dropping_output() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let first_emit = Arc::new(AtomicBool::new(true));
    let first_emit_for_pump = Arc::clone(&first_emit);
    let entered_emit = Arc::new(Barrier::new(2));
    let entered_emit_for_pump = Arc::clone(&entered_emit);
    let release_emit = Arc::new(Barrier::new(2));
    let release_emit_for_pump = Arc::clone(&release_emit);
    let (sender, handle) =
        spawn_terminal_output_pump(Duration::from_secs(60), 1, 1, move |output| {
            if first_emit_for_pump.swap(false, Ordering::AcqRel) {
                tokio::task::block_in_place(|| {
                    entered_emit_for_pump.wait();
                    release_emit_for_pump.wait();
                });
            }
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        });

    sender
        .send(TerminalOutputChunk::new(b"a", false))
        .await
        .expect("first output should be accepted");
    tokio::task::block_in_place(|| entered_emit.wait());
    sender
        .send(TerminalOutputChunk::new(b"b", false))
        .await
        .expect("second output should fill the queue");
    let blocked = tokio::time::timeout(
        Duration::from_millis(20),
        sender.send(TerminalOutputChunk::new(b"c", false)),
    )
    .await;
    assert!(
        blocked.is_err(),
        "full output queue must apply backpressure"
    );

    tokio::task::block_in_place(|| release_emit.wait());
    sender
        .send(TerminalOutputChunk::new(b"c", false))
        .await
        .expect("output should resume after the consumer catches up");
    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("pump ok");

    let data = emitted
        .lock()
        .expect("capture mutex")
        .iter()
        .map(|output| output.data.as_str())
        .collect::<String>();
    assert_eq!(data, "abc");
}

#[tokio::test]
async fn frontend_ack_resumes_output_only_after_the_low_watermark() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        1,
        TerminalOutputFlowControl::new(2, 0, OUTPUT_ACK_TIMEOUT),
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );

    sender
        .send(TerminalOutputChunk::new(b"ab", false))
        .await
        .expect("initial output should be accepted");
    tokio::time::timeout(Duration::from_millis(100), async {
        loop {
            if emitted.lock().expect("capture mutex").len() == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("initial output should reach the frontend");

    sender
        .send(TerminalOutputChunk::new(b"c", false))
        .await
        .expect("one chunk should fill the bounded queue");
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            sender.send(TerminalOutputChunk::new(b"d", false)),
        )
        .await
        .is_err(),
        "producer must block while frontend output is unacknowledged"
    );

    control.ack(1);
    assert!(
        tokio::time::timeout(
            Duration::from_millis(20),
            sender.send(TerminalOutputChunk::new(b"d", false)),
        )
        .await
        .is_err(),
        "partial ACK above the low watermark must keep output paused"
    );

    control.ack(1);
    sender
        .send(TerminalOutputChunk::new(b"d", false))
        .await
        .expect("producer should resume after ACK reaches the low watermark");
    control.finish();
    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("pump ok");

    let data = emitted
        .lock()
        .expect("capture mutex")
        .iter()
        .map(|output| output.data.as_str())
        .collect::<String>();
    assert_eq!(data, "abcd");
}

#[tokio::test]
async fn partial_frontend_ack_refreshes_the_stalled_output_deadline() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let ack_timeout = Duration::from_millis(80);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        1,
        TerminalOutputFlowControl::new(4, 0, ack_timeout),
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );

    sender
        .send(TerminalOutputChunk::new(b"abcd", false))
        .await
        .expect("initial output should be accepted");
    tokio::time::timeout(Duration::from_millis(100), async {
        loop {
            if emitted.lock().expect("capture mutex").len() == 4 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("initial output should reach the frontend");
    tokio::task::yield_now().await;

    tokio::time::sleep(Duration::from_millis(50)).await;
    control.ack(1);
    tokio::task::yield_now().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    control.ack(1);
    tokio::task::yield_now().await;

    assert!(
        !handle.is_finished(),
        "each positive ACK must refresh the no-progress watchdog even while outstanding output remains above the low watermark"
    );

    control.finish();
    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("progressing frontend ACKs should keep the pump alive");
}

#[tokio::test]
async fn producer_eof_finishes_even_when_frontend_never_acks() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        2,
        TerminalOutputFlowControl::new(1, 0, OUTPUT_ACK_TIMEOUT),
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );

    sender
        .send(TerminalOutputChunk::new(b"a", false))
        .await
        .expect("first chunk should be accepted");
    tokio::time::timeout(Duration::from_millis(100), async {
        loop {
            if emitted.lock().expect("capture mutex").len() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("first chunk should be emitted");

    // The high-water pause is active and no ACK is sent. Closing the producer
    // must still let the pump flush and terminate so the session can be
    // removed after natural EOF.
    drop(sender);
    tokio::time::timeout(Duration::from_millis(200), handle)
        .await
        .expect("producer EOF must wake a paused pump")
        .expect("pump task should join")
        .expect("pump ok");
    control.finish();
}

#[tokio::test]
async fn missing_frontend_ack_releases_a_blocked_producer_after_deadline() {
    let (sender, _control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        1,
        TerminalOutputFlowControl::new(1, 0, Duration::from_millis(25)),
        |_output| Ok(()),
    );

    sender
        .send(TerminalOutputChunk::new(b"a", false))
        .await
        .expect("initial output should be accepted");
    tokio::task::yield_now().await;
    sender
        .send(TerminalOutputChunk::new(b"b", false))
        .await
        .expect("one queued chunk should be accepted while output is paused");

    let blocked_producer =
        tokio::spawn(async move { sender.send(TerminalOutputChunk::new(b"c", false)).await });
    tokio::task::yield_now().await;

    let pump_result = tokio::time::timeout(Duration::from_millis(250), handle)
        .await
        .expect("the output pump must not wait forever for a missing ACK")
        .expect("pump task should join");
    assert!(
        pump_result
            .expect_err("missing ACK must fail the output pump")
            .contains("frontend output ACK timed out"),
        "the failure should identify the stalled frontend ACK"
    );
    assert!(
        blocked_producer
            .await
            .expect("producer task should join")
            .is_err(),
        "dropping the stalled pump must wake a producer blocked on the bounded queue"
    );
}

#[tokio::test]
async fn frontend_over_ack_fails_closed() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        1,
        TerminalOutputFlowControl::new(8, 0, OUTPUT_ACK_TIMEOUT),
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );
    sender
        .send(TerminalOutputChunk::new(b"a", false))
        .await
        .expect("one output byte should be accepted");
    tokio::time::timeout(Duration::from_millis(100), async {
        loop {
            if emitted.lock().expect("capture mutex").len() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the output byte should reach the frontend");

    control.ack(2);
    let error = tokio::time::timeout(Duration::from_millis(100), handle)
        .await
        .expect("invalid ACK should wake the output pump")
        .expect("pump task should join")
        .expect_err("ACK beyond outstanding output must fail closed");
    drop(sender);

    assert!(
        error.contains("exceeds") && error.contains("outstanding"),
        "the error should identify invalid output credit: {error}"
    );
}

#[test]
fn duplicate_frontend_ack_for_the_same_batch_fails_closed() {
    let control = TerminalOutputControl {
        state: Arc::new(TerminalOutputControlState::default()),
    };
    let mut unacked_bytes = 1;

    control.ack(1);
    assert!(
        !control
            .apply(&mut unacked_bytes)
            .expect("the first ACK should consume the outstanding byte")
            .finishing
    );
    assert_eq!(unacked_bytes, 0);

    control.ack(1);
    let error = control
        .apply(&mut unacked_bytes)
        .expect_err("ACKing the same output batch twice must fail closed");

    assert!(
        error.contains("exceeds") && error.contains("outstanding"),
        "the error should identify duplicate output credit: {error}"
    );
}

#[tokio::test]
async fn finish_wakes_a_paused_pump_and_drains_queued_output() {
    let emitted = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&emitted);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_secs(60),
        1,
        1,
        TerminalOutputFlowControl::new(1, 0, Duration::from_secs(60)),
        move |output| {
            captured.lock().expect("capture mutex").push(output);
            Ok(())
        },
    );

    sender
        .send(TerminalOutputChunk::new(b"a", false))
        .await
        .expect("first output byte should be accepted");
    while emitted.lock().expect("capture mutex").is_empty() {
        tokio::task::yield_now().await;
    }

    sender
        .send(TerminalOutputChunk::new(b"b", false))
        .await
        .expect("one chunk should queue while the pump is paused");
    control.finish();
    tokio::task::yield_now().await;

    let data = emitted
        .lock()
        .expect("capture mutex")
        .iter()
        .map(|output| output.data.as_str())
        .collect::<String>();
    assert_eq!(data, "ab");

    drop(sender);
    handle
        .await
        .expect("pump task should join")
        .expect("pump should drain cleanly");
}

#[test]
fn late_ack_after_output_cleanup_is_idempotent() {
    let session_id = format!("completed-output-{}", uuid::Uuid::new_v4());
    with_session_output_controls(|controls| {
        controls.remove(&session_id);
    });

    assert!(
        ack_session_output(&session_id, 7).is_ok(),
        "a delayed xterm callback must not turn natural EOF into an I/O error"
    );
}
