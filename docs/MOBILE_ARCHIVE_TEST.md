# Archived static frontend on device (LOOM-683)

**Blocked on physical device/simulator** — run before each mobile RC:

1. `make weave-web` then package with `make tablet-weave` or Capacitor sync.
2. Install IPA on simulator/device (no Metro/dev server).
3. Cold launch → open catalog chart → import local CSV → export PNG.
4. Confirm API calls hit `https://loom.ibm.io/api/*` (not `capacitor://localhost/api`).

Record device model, iOS version, commit SHA in release notes.
