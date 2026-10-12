/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeOneShotReload,
  markReloadOnce,
  readStoredBuildId,
  storeBuildId,
} from "../deployVersionGuard";

describe("deployVersionGuard", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and reads build id", () => {
    storeBuildId("build-a");
    expect(readStoredBuildId()).toBe("build-a");
  });

  it("one-shot reload flag is consumed once", () => {
    markReloadOnce();
    expect(consumeOneShotReload()).toBe(true);
    expect(consumeOneShotReload()).toBe(false);
  });

  it("after reload accept, stored id matches the new deploy", () => {
    storeBuildId("build-old");
    markReloadOnce();
    expect(consumeOneShotReload()).toBe(true);
    storeBuildId("build-new");
    expect(readStoredBuildId()).toBe("build-new");
    expect(readStoredBuildId()).not.toBe("build-old");
  });
});
