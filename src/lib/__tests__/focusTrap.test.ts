import { describe, expect, it } from "vitest";
import { trapTabKey } from "../focusTrap";

describe("trapTabKey", () => {
  it("returns false for non-Tab keys", () => {
    const root = { contains: () => true } as unknown as HTMLElement;
    const e = { key: "Enter", preventDefault: () => {} } as KeyboardEvent;
    expect(trapTabKey(root, e)).toBe(false);
  });
});
