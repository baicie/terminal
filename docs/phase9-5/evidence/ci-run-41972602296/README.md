# Upgrade evidence — run 41972602296

- Linux real DEB upgrade: `0.0.1-dev.1` (`4ed449bf…`) → `0.0.1-dev.2`
  (`80c40e72…`), real `apt-get`/dpkg install, `dpkg-query` version read-back,
  field-by-field data verification.
- Windows isolation preflight: shared runner `runneradmin`; target
  `C:\Users\runneradmin\AppData\Roaming\com.baicie.termius`; `isolated=false`,
  `wouldTouchRealProfile=true`; no install/delete performed.
- Linux AppImage in this run still had the headless EGL failure; the final
  payload-only result is under `ci-run-41980039459/linux-appimage/`.
