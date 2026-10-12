import { describe, expect, it, vi } from "vitest";

vi.mock("../isDesktop", () => ({ isDesktop: () => false }));

describe("tauri web guards", () => {
  it("queryFile rejects SQL on web", async () => {
    const { queryFile, WEB_FILE_SQL_ERROR } = await import("../tauri");
    await expect(queryFile("web://a.csv", "SELECT 1")).rejects.toThrow(WEB_FILE_SQL_ERROR);
  });
});
