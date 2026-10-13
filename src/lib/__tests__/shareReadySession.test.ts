import { beforeEach, describe, expect, it } from "vitest";
import { useLoomStore } from "../store";
import {
  beginShareReadyAspect,
  clearShareReadyAspectBackup,
  endShareReadyAspect,
} from "../shareReadySession";

describe("shareReadySession", () => {
  beforeEach(() => {
    clearShareReadyAspectBackup();
    useLoomStore.setState((s) => ({
      appSettings: { ...s.appSettings, chartAspect: "free" },
    }));
  });

  it("restores the prior aspect after share-ready", () => {
    beginShareReadyAspect("9:16");
    expect(useLoomStore.getState().appSettings.chartAspect).toBe("9:16");
    endShareReadyAspect();
    expect(useLoomStore.getState().appSettings.chartAspect).toBe("free");
  });

  it("end without begin is a no-op", () => {
    endShareReadyAspect();
    expect(useLoomStore.getState().appSettings.chartAspect).toBe("free");
  });
});
