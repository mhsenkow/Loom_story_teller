import { describe, expect, it } from "vitest";
import { readBootstrapShellWidth, readBootstrapShellMode } from "../shellBootstrap";

describe("shellBootstrap readers", () => {
  it("returns null without document", () => {
    expect(readBootstrapShellWidth()).toBeNull();
    expect(readBootstrapShellMode()).toBeNull();
  });
});
