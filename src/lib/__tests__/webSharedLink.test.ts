import { describe, it, expect } from "vitest";
import { remoteCsvLoadHost, remoteCsvLoadPrompt } from "../webSharedLink";

describe("webSharedLink", () => {
  it("extracts host for consent copy", () => {
    expect(remoteCsvLoadHost("https://data.example.com/foo.csv")).toBe("data.example.com");
  });

  it("builds load prompt with host", () => {
    expect(remoteCsvLoadPrompt("https://host.example/x.csv")).toContain("host.example");
    expect(remoteCsvLoadPrompt("https://host.example/x.csv")).toMatch(/Load\?/);
  });
});
