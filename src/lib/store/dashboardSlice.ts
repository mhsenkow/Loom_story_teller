// =================================================================
// dashboardSlice — dashboards, slots, layout, undo
// =================================================================

import type { LoomState, DashboardItem, DashboardSlot, DashboardLayoutTemplate, DashboardRefreshInterval } from "./types";
import { newLoomId } from "../loomId";

export function dashboardInitialState() {
  return {
    dashboards: [] as DashboardItem[],
    activeDashboardId: null as string | null,
    dashboardsExpanded: false,
    previewCapture: null as LoomState["previewCapture"],
    dashboardUndoSnapshot: null as { dashboards: DashboardItem[]; activeDashboardId: string | null } | null,
  };
}

type Setter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;

export function createDashboardSlice(set: Setter) {
  return {
    setDashboards: (dashboards: DashboardItem[]) => set({ dashboards: dashboards.slice(0, 20) }),
    addDashboard: (name: string) =>
      set((s) => {
        const id = newLoomId("db-");
        return { dashboards: [{ id, name: name.trim() || "Dashboard", slots: [], layoutTemplate: "auto" as const, refreshInterval: "manual" as const, lastRefreshedAt: Date.now() }, ...s.dashboards.slice(0, 19)], activeDashboardId: id };
      }),
    removeDashboard: (id: string) =>
      set((s) => ({
        dashboardUndoSnapshot: { dashboards: JSON.parse(JSON.stringify(s.dashboards)), activeDashboardId: s.activeDashboardId },
        dashboards: s.dashboards.filter((d) => d.id !== id),
        activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
        toastMessage: "Dashboard removed",
        toastShowUndo: true,
      })),
    setDashboardRefresh: (dashboardId: string, interval: DashboardRefreshInterval | null, lastRefreshedAt?: number) =>
      set((s) => ({ dashboards: s.dashboards.map((d) => d.id === dashboardId ? { ...d, refreshInterval: interval ?? d.refreshInterval, lastRefreshedAt: lastRefreshedAt ?? d.lastRefreshedAt } : d) })),
    setDashboardSlots: (dashboardId: string, slots: DashboardSlot[]) =>
      set((s) => ({ dashboards: s.dashboards.map((d) => d.id === dashboardId ? { ...d, slots: slots.slice(0, 24) } : d) })),
    setDashboardLayout: (dashboardId: string, layoutTemplate: DashboardLayoutTemplate) =>
      set((s) => ({ dashboards: s.dashboards.map((d) => d.id === dashboardId ? { ...d, layoutTemplate } : d) })),
    moveDashboardSlot: (dashboardId: string, slotId: string, direction: "up" | "down") =>
      set((s) => ({ dashboards: s.dashboards.map((d) => {
        if (d.id !== dashboardId) return d;
        const i = d.slots.findIndex((sl) => sl.id === slotId);
        if (i < 0) return d;
        const next = [...d.slots];
        const j = direction === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= next.length) return d;
        [next[i], next[j]] = [next[j], next[i]];
        return { ...d, slots: next };
      }) })),
    addDashboardSlot: (dashboardId: string, viewType: "table" | "chart" | "query" | "snapshot", viewId: string) =>
      set((s) => ({ dashboards: s.dashboards.map((d) => d.id !== dashboardId ? d : { ...d, slots: [...d.slots, { id: `ds-${Date.now()}`, viewType, viewId }] }) })),
    removeDashboardSlot: (dashboardId: string, slotId: string) =>
      set((s) => ({
        dashboardUndoSnapshot: { dashboards: JSON.parse(JSON.stringify(s.dashboards)), activeDashboardId: s.activeDashboardId },
        dashboards: s.dashboards.map((d) => d.id === dashboardId ? { ...d, slots: d.slots.filter((sl) => sl.id !== slotId) } : d),
        toastMessage: "View removed from dashboard",
        toastShowUndo: true,
      })),
    setActiveDashboardId: (id: string | null) => set({ activeDashboardId: id }),
    setDashboardsExpanded: (v: boolean) => set({ dashboardsExpanded: v }),
    setPreviewCapture: (v: LoomState["previewCapture"]) => set({ previewCapture: v }),
    restoreDashboardUndo: () =>
      set((s) => {
        if (!s.dashboardUndoSnapshot) return s;
        return { dashboards: s.dashboardUndoSnapshot.dashboards, activeDashboardId: s.dashboardUndoSnapshot.activeDashboardId, dashboardUndoSnapshot: null, toastMessage: "Restored", toastShowUndo: false };
      }),
    clearDashboardUndo: () => set({ dashboardUndoSnapshot: null, toastShowUndo: false }),
  };
}
