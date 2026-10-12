// =================================================================
// dashboardSlice tests
// =================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { useLoomStore } from "../../store";

function getState() { return useLoomStore.getState(); }

beforeEach(() => { getState().reset(); });

describe("dashboardSlice", () => {
  it("addDashboard creates with default layout", () => {
    getState().addDashboard("Test");
    expect(getState().dashboards).toHaveLength(1);
    expect(getState().dashboards[0]!.name).toBe("Test");
    expect(getState().activeDashboardId).toBe(getState().dashboards[0]!.id);
  });

  it("removeDashboard saves undo snapshot", () => {
    getState().addDashboard("D1");
    const id = getState().dashboards[0]!.id;
    getState().removeDashboard(id);
    expect(getState().dashboards).toHaveLength(0);
    expect(getState().dashboardUndoSnapshot).not.toBeNull();
  });

  it("restoreDashboardUndo restores", () => {
    getState().addDashboard("D1");
    const id = getState().dashboards[0]!.id;
    getState().removeDashboard(id);
    getState().restoreDashboardUndo();
    expect(getState().dashboards).toHaveLength(1);
  });

  it("setDashboardLayout updates template", () => {
    getState().addDashboard("D1");
    const id = getState().dashboards[0]!.id;
    getState().setDashboardLayout(id, "2x2");
    expect(getState().dashboards[0]!.layoutTemplate).toBe("2x2");
  });

  it("addDashboardSlot / removeDashboardSlot lifecycle", () => {
    getState().addDashboard("D1");
    const dbId = getState().dashboards[0]!.id;
    getState().addDashboardSlot(dbId, "chart", "cv-1");
    expect(getState().dashboards[0]!.slots).toHaveLength(1);
    const slotId = getState().dashboards[0]!.slots[0]!.id;
    getState().removeDashboardSlot(dbId, slotId);
    expect(getState().dashboards[0]!.slots).toHaveLength(0);
  });

  it("moveDashboardSlot swaps positions", () => {
    getState().addDashboard("D1");
    const dbId = getState().dashboards[0]!.id;
    getState().addDashboardSlot(dbId, "chart", "cv-1");
    getState().addDashboardSlot(dbId, "chart", "cv-2");
    const slot0 = getState().dashboards[0]!.slots[0]!.id;
    getState().moveDashboardSlot(dbId, slot0, "down");
    expect(getState().dashboards[0]!.slots[1]!.id).toBe(slot0);
  });
});
