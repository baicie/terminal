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

/// Ten mebibytes through the real pump: order preserved, nothing dropped.
///
/// ## What the existing cases cover, and what they do not
///
/// The module already has thorough small-scale coverage — unicode across byte
/// boundaries, batching without reordering, the bounded queue applying backpressure,
/// ACK resuming only below the low watermark, over-ACK failing closed, a missing ACK
/// releasing a blocked producer after the deadline. None of those pushes **volume**
/// through: the largest payload in the suite is a handful of bytes, and `max_batch_bytes`
/// is never exercised at a realistic size.
///
/// That leaves a class of bug untested: something that only shows up when a real command
/// (`yes`, a build log, `cat` of a large file) fills the pipe. A batcher that mishandles
/// a boundary at 64 KiB, a watermark that stops being enforced once the queue rotates
/// many times, or an ACK path that loses a batch after the hundredth round would all
/// pass every existing case.
///
/// The task asks for at least 10 MiB with ordering checked, so this drives exactly that
/// and verifies the stream against its own structure rather than a length alone.
#[tokio::test]
async fn ten_mebibytes_survive_the_pump_in_order() {
    const TOTAL: usize = 10 * 1024 * 1024;
    const CHUNK: usize = 32 * 1024;

    let emitted = Arc::new(Mutex::new(Vec::with_capacity(TOTAL)));
    let captured = Arc::clone(&emitted);
    let (sender, control, handle) = spawn_terminal_output_pump_with_flow_control(
        Duration::from_millis(1),
        /*
         * A small batch size on purpose: 8 KiB against 32 KiB chunks means the batcher
         * crosses its byte limit four times per chunk. With 64 KiB against 32 KiB chunks
         * the boundary is almost never hit — measured: a mutation that skipped a byte at
         * every batch boundary still passed, because there were barely any boundaries.
         */
        8 * 1024,
        64,
        // A real watermark: the pump must pause and rely on ACKs, as it does in the app.
        TerminalOutputFlowControl::new(256 * 1024, 64 * 1024, Duration::from_secs(30)),
        move |output| {
            captured
                .lock()
                .expect("capture mutex")
                .extend_from_slice(output.data.as_bytes());
            Ok(())
        },
    );

    /*
     * Producer and acknowledger both run in this task's runtime.
     *
     * The producer is spawned because `send` blocks once the queue fills — the same
     * backpressure the PTY reader meets. The acknowledger runs below, releasing the
     * watermark as output lands, which is what the front end does on every receipt.
     */
    let producer = tokio::spawn(async move {
        let mut written = 0usize;
        let mut counter: u32 = 0;
        while written < TOTAL {
            /*
             * ## ASCII, not raw counters
             *
             * The first version filled the body with little-endian `u32` counters. The
             * pump decodes with `String::from_utf8_lossy`, so bytes that are not valid
             * UTF-8 become U+FFFD — three bytes each — and a 10 MiB target arrived as
             * 15,275,520 bytes. That is correct behaviour, not a defect: a PTY carries
             * text, and the decoder's job is to keep going when a command emits a stray
             * byte.
             *
             * The test was wrong to use binary. Eight-hex-digit groups per counter keep
             * the payload position-recoverable **and** valid ASCII, so the byte count
             * and the ordering check both describe the stream the product actually sees.
             */
            let mut body = String::with_capacity(CHUNK);
            while body.len() < CHUNK {
                body.push_str(&format!("{counter:08x}"));
                counter = counter.wrapping_add(1);
            }
            let mut body = body.into_bytes();
            let remaining = TOTAL - written;
            if body.len() > remaining {
                body.truncate(remaining);
            }
            let sent = body.len();
            if sender
                .send(TerminalOutputChunk::new(&body, false))
                .await
                .is_err()
            {
                break;
            }
            written += sent;
        }
        written
    });

    /*
     * Acknowledge what has actually been received, which is what the front end does.
     *
     * `TerminalOutputControl` exposes `ack`, `finish` and the session-level helpers, but
     * no accessor for the outstanding count — the pump owns that number. So the test
     * tracks what it has seen and acknowledges the difference; acknowledging more than
     * the pump has emitted would (correctly) fail it closed and the `handle.await` below
     * would report the error instead of a silent pass.
     */
    let mut acked = 0usize;
    for _ in 0..500_000 {
        let received = emitted.lock().expect("capture mutex").len();
        if received > acked {
            control.ack(received - acked);
            acked = received;
        }
        if producer.is_finished() && received >= TOTAL {
            break;
        }
        tokio::task::yield_now().await;
    }

    let produced = producer.await.expect("producer must not panic");
    assert_eq!(produced, TOTAL, "the producer must have written every byte");

    control.finish();
    handle
        .await
        .expect("pump task must join")
        .expect("pump must not report an error");

    let bytes = emitted.lock().expect("capture mutex").clone();
    assert_eq!(bytes.len(), TOTAL, "every byte must arrive exactly once");

    // Ordering, at the granularity the payload provides: eight hex digits per counter.
    let text = String::from_utf8(bytes).expect("the payload is ASCII by construction");
    let mut expected: u32 = 0;
    for (index, group) in text.as_bytes().chunks_exact(8).enumerate() {
        let value = u32::from_str_radix(
            std::str::from_utf8(group).expect("hex digits are ASCII"),
            16,
        )
        .expect("each group is eight hex digits");
        assert_eq!(
            value, expected,
            "the stream is out of order at group {index} (expected counter {expected})"
        );
        expected = expected.wrapping_add(1);
    }
    assert_eq!(
        text.len() % 8,
        0,
        "a truncated tail means the body was split mid-counter"
    );
    assert!(
        acked >= TOTAL / 2,
        "the acknowledger must have released most of the stream, acked={acked}"
    );
}
