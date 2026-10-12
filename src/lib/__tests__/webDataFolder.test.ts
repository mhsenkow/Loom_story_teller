import { describe, expect, it } from "vitest";
import {
  WEB_VAULT_LABEL,
  WEB_VAULT_PATH,
  isWebVaultPath,
  webVaultDisplayName,
} from "../webDataFolder";

describe("webDataFolder", () => {
  it("treats web:// and web://my-data as the vault", () => {
    expect(isWebVaultPath("web://")).toBe(true);
    expect(isWebVaultPath(WEB_VAULT_PATH)).toBe(true);
    expect(isWebVaultPath("web://other.csv")).toBe(false);
  });

  it("labels the vault for the sidebar", () => {
    expect(webVaultDisplayName(WEB_VAULT_PATH)).toBe(WEB_VAULT_LABEL);
    expect(
      webVaultDisplayName(WEB_VAULT_PATH, {
        displayName: "LoomCSVs",
        linkedAt: 1,
      }),
    ).toBe(`${WEB_VAULT_LABEL} · LoomCSVs`);
  });
});
