import { describe, expect, it } from "vitest";
import { reconcileLinkedFolder, fingerprintLinkedFile } from "../linkedFolderReconcile";

describe("linkedFolderReconcile (LOOM-255)", () => {
  it("classifies added, modified, unchanged, and removed", () => {
    const prior = [
      { stablePath: "web://file/a.csv", displayName: "a.csv", size: 10, lastModified: 100 },
      { stablePath: "web://file/gone.csv", displayName: "gone.csv", size: 5, lastModified: 50 },
    ];
    const aSame = new File(["1234567890"], "a.csv", { type: "text/csv", lastModified: 100 });
    const bNew = new File(["abc"], "b.csv", { type: "text/csv", lastModified: 200 });
    const cMod = new File(["12345678901"], "c.csv", { type: "text/csv", lastModified: 300 });
    const priorC = { stablePath: "web://file/c.csv", displayName: "c.csv", size: 10, lastModified: 100 };
    const summary = reconcileLinkedFolder([aSame, bNew, cMod], [...prior, priorC]);
    expect(summary.unchanged.map((x) => x.displayName)).toEqual(["a.csv"]);
    expect(summary.added.map((x) => x.displayName)).toEqual(["b.csv"]);
    expect(summary.modified.map((x) => x.displayName)).toEqual(["c.csv"]);
    expect(summary.removedFromFolder.map((x) => x.displayName)).toEqual(["gone.csv"]);
    expect(fingerprintLinkedFile(bNew).stablePath).toContain("web://file/");
  });
});
