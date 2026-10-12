import { describe, expect, it } from "vitest";
import { chartStageLiveMessage, chartStageStatus } from "../chartStageStatus";

describe("chartStageStatus", () => {
  it("surfaces loading", () => {
    const s = chartStageStatus({ loadingSample: true, hasChart: true, hasRows: false, renderError: null });
    expect(chartStageLiveMessage(s)).toMatch(/Loading/);
  });
});
