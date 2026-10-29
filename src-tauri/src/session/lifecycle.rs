use tokio::sync::watch;

#[derive(Clone, Debug)]
pub(crate) struct SessionLifecycle {
    completed_tx: watch::Sender<bool>,
}

#[derive(Debug)]
pub(crate) struct SessionCompletion {
    completed_rx: watch::Receiver<bool>,
}

impl SessionLifecycle {
    pub(crate) fn new() -> Self {
        let (completed_tx, _) = watch::channel(false);
        Self { completed_tx }
    }

    pub(crate) fn complete(&self) {
        self.completed_tx.send_replace(true);
    }

    pub(crate) fn completion(&self) -> SessionCompletion {
        SessionCompletion {
            completed_rx: self.completed_tx.subscribe(),
        }
    }
}

impl SessionCompletion {
    pub(crate) async fn wait(mut self) {
        if *self.completed_rx.borrow_and_update() {
            return;
        }

        while self.completed_rx.changed().await.is_ok() {
            if *self.completed_rx.borrow_and_update() {
                return;
            }
        }
    }
}
