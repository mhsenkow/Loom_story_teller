# Mobile release acceptance checklist (LOOM-700)

Complete on a **physical device** using the **archived static export** (IPA or Release build — not `next dev`).

**Build under test:** _______________  
**Device / iOS:** _______________  
**Shell:** Tauri iOS ☐ · Capacitor ☐  
**Tester / date:** _______________

## Journey

| Step | Pass | Notes / backlog ID |
|------|------|-------------------|
| Fresh install opens to Start / onboarding | ☐ | |
| Discover or import data (local file or catalog) | ☐ | |
| Chart renders and responds to encoding changes | ☐ | |
| Keyboard / field editing in Query or Dive | ☐ | |
| Background app → resume (no white screen) | ☐ | |
| Force-quit → reopen; session / folder state sane | ☐ | |
| Export PNG, CSV, or HTML reaches Share or Files | ☐ | |
| Share a chart PNG → Save Image asks for Photos access and saves (no crash) | ☐ | |
| Feedback → Attach screenshot → Take Photo asks for camera access (no crash) | ☐ | |
| Airplane mode: offline message, no infinite spinner | ☐ | |
| Oversized file rejected with clear error | ☐ | |

## Evidence

- Screenshot or screen recording for share/export step
- Version + build from Settings or Xcode Organizer
- Link any failure to a `LOOM-###` item in the backlog

**Sign-off:** ☐ Ready for TestFlight / App Store submission
