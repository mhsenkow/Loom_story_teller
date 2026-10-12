import { describe, it, expect } from "vitest";
import { migrateAppSettingsV0, unwrapPersist, wrapPersist } from "../persistEnvelope";

describe("persistEnvelope", () => {
  it("migrates high-contrast theme", () => {
    const out = migrateAppSettingsV0({ theme: "high-contrast" });
    expect(out?.theme).toBe("contrast");
  });

  it("round-trips wrapped settings", () => {
    const raw = wrapPersist({ theme: "dark" });
    const data = unwrapPersist(raw, (v, d) => (v === 0 ? migrateAppSettingsV0(d) : null));
    expect(data).toEqual({ theme: "dark" });
  });
});
