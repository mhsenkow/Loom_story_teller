/**
 * friendlyError: network failures read as "offline"; other errors keep their message.
 */
import { describe, it, expect } from "vitest";
import { friendlyError } from "@/components/sidebar/shared";

describe("friendlyError", () => {
  it("turns fetch TypeErrors into plain offline text", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toBe("you're offline or the server didn't answer");
    expect(friendlyError(new TypeError("Load failed"))).toBe("you're offline or the server didn't answer");
    expect(friendlyError(new TypeError("NetworkError when attempting to fetch resource."))).toBe("you're offline or the server didn't answer");
  });

  it("does not call a code/data TypeError an outage", () => {
    expect(friendlyError(new TypeError("Cannot read properties of null (reading 'rows')"))).toBe(
      "Cannot read properties of null (reading 'rows')",
    );
  });

  it("keeps Tauri string rejections and Error messages", () => {
    expect(friendlyError("table wiki_stream missing")).toBe("table wiki_stream missing");
    expect(friendlyError(new Error("HTTP 503"))).toBe("HTTP 503");
    expect(friendlyError({ message: "bad" })).toBe("bad");
  });
});
