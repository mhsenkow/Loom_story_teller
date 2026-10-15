// =================================================================
// shellLayout — phone / tablet / desktop chrome policy
// =================================================================

import { describe, expect, it } from "vitest";
import { detectDevice } from "../chartViewport";
import {
  applyShellModeTransition,
  dashboardGridClass,
  dashboardGridStyle,
  parseDesktopPrefs,
  serializeDesktopPrefs,
  shellDefaultsForMode,
  shellModeFromDevice,
  shellModeFromWidth,
  sidebarOverlays,
  panelIsSheet,
} from "../shellLayout";

describe("shellModeFromWidth", () => {
  it("aligns with detectDevice cutoffs", () => {
    expect(shellModeFromWidth(390)).toBe("phone");
    expect(shellModeFromWidth(767)).toBe("phone");
    expect(shellModeFromWidth(768)).toBe("tablet");
    expect(shellModeFromWidth(900)).toBe("tablet");
    expect(shellModeFromWidth(1099)).toBe("tablet");
    expect(shellModeFromWidth(1100)).toBe("desktop");
    expect(shellModeFromDevice(detectDevice(500))).toBe("phone");
    expect(shellModeFromDevice(detectDevice(900))).toBe("tablet");
    expect(shellModeFromDevice(detectDevice(1200))).toBe("desktop");
  });
});

describe("applyShellModeTransition", () => {
  it("closes both drawers on enter phone", () => {
    expect(
      applyShellModeTransition({
        prevMode: "desktop",
        nextMode: "phone",
        desktopPrefs: { sidebarOpen: true, panelOpen: true },
      }),
    ).toEqual({ sidebarOpen: false, panelOpen: false });
  });

  it("closes sidebar and opens panel on enter tablet", () => {
    expect(
      applyShellModeTransition({
        prevMode: "phone",
        nextMode: "tablet",
        desktopPrefs: null,
      }),
    ).toEqual({ sidebarOpen: false, panelOpen: true });
  });

  it("restores desktop prefs when leaving phone/tablet", () => {
    expect(
      applyShellModeTransition({
        prevMode: "phone",
        nextMode: "desktop",
        desktopPrefs: { sidebarOpen: false, panelOpen: true },
      }),
    ).toEqual({ sidebarOpen: false, panelOpen: true });
  });

  it("defaults both open on desktop when no prefs saved", () => {
    expect(
      applyShellModeTransition({
        prevMode: "tablet",
        nextMode: "desktop",
        desktopPrefs: null,
      }),
    ).toEqual(shellDefaultsForMode("desktop"));
  });

  it("cold load phone uses mode defaults", () => {
    expect(
      applyShellModeTransition({
        prevMode: null,
        nextMode: "phone",
        desktopPrefs: { sidebarOpen: true, panelOpen: true },
      }),
    ).toEqual({ sidebarOpen: false, panelOpen: false });
  });
});

describe("overlay helpers", () => {
  it("sidebar overlays on phone and tablet; panel sheet only on phone", () => {
    expect(sidebarOverlays("phone")).toBe(true);
    expect(sidebarOverlays("tablet")).toBe(true);
    expect(sidebarOverlays("desktop")).toBe(false);
    expect(panelIsSheet("phone")).toBe(true);
    expect(panelIsSheet("tablet")).toBe(false);
    expect(panelIsSheet("desktop")).toBe(false);
  });
});

describe("desktop prefs serialize", () => {
  it("roundtrips", () => {
    const prefs = { sidebarOpen: true, panelOpen: false };
    expect(parseDesktopPrefs(serializeDesktopPrefs(prefs))).toEqual(prefs);
    expect(parseDesktopPrefs("nope")).toBeNull();
    expect(parseDesktopPrefs(null)).toBeNull();
  });
});

describe("dashboardGridClass / style", () => {
  it("collapses multi-column templates on phone", () => {
    expect(dashboardGridClass("3x2", "phone")).toBe("grid-cols-1");
    expect(dashboardGridClass("2x2", "phone")).toBe("grid-cols-1");
    expect(dashboardGridClass("stream", "phone")).toBe("grid-cols-1");
    expect(dashboardGridClass("1+2", "phone")).toBe("grid-cols-1");
    expect(dashboardGridStyle("1+2", "phone")).toBeUndefined();
    expect(dashboardGridStyle("stream", "phone")).toBeUndefined();
  });

  it("caps tablet at two columns", () => {
    expect(dashboardGridClass("3x2", "tablet")).toBe("grid-cols-2");
    expect(dashboardGridClass("stream", "tablet")).toBe("grid-cols-2");
    expect(dashboardGridClass("2x1", "tablet")).toBe("grid-cols-2");
    expect(dashboardGridStyle("stream", "tablet")).toBeUndefined();
    expect(dashboardGridStyle("1+2", "tablet")).toBeUndefined();
  });

  it("keeps desktop templates", () => {
    expect(dashboardGridClass("3x2", "desktop")).toBe("grid-cols-3");
    expect(dashboardGridStyle("1+2", "desktop")?.gridTemplateColumns).toBe("1fr 1fr");
    expect(dashboardGridStyle("stream", "desktop")?.gridTemplateColumns).toBe("repeat(3, 1fr)");
    expect(dashboardGridClass("auto", "desktop")).toContain("xl:grid-cols-4");
  });
});

describe("touch-aware shell mode", () => {
  it("keeps iPad landscape widths in tablet chrome when touch-primary", () => {
    for (const w of [1133, 1180, 1194, 1366]) {
      expect(shellModeFromWidth(w, true)).toBe("tablet");
      expect(shellModeFromWidth(w, false)).toBe("desktop");
    }
  });
  it("still uses desktop chrome for wide touch screens", () => {
    expect(shellModeFromWidth(1440, true)).toBe("desktop");
  });
  it("phone cutoff is width-only", () => {
    expect(shellModeFromWidth(400, true)).toBe("phone");
    expect(shellModeFromWidth(400, false)).toBe("phone");
  });
});
