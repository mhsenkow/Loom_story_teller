import { describe, expect, it } from "vitest";
import { fieldDisplayName } from "../fieldDisplayName";

describe("fieldDisplayName", () => {
  it("names feed columns with their registry unit", () => {
    expect(fieldDisplayName("anomaly_c", "climate")).toBe("temperature anomaly (°C)");
    expect(fieldDisplayName("change_pct", "fx")).toBe("change (%)");
    expect(fieldDisplayName("max_delay_min", "faa_delays")).toBe("max delay (minutes)");
  });

  it("skips units that add nothing to an axis", () => {
    expect(fieldDisplayName("points", "hn")).toBe("points");
    expect(fieldDisplayName("rank", "crypto")).toBe("rank");
  });

  it("tidies snake_case from uploads without a registry", () => {
    expect(fieldDisplayName("Revenue_USD")).toBe("Revenue (USD)");
    expect(fieldDisplayName("signup_rate_pct")).toBe("signup rate (%)");
    expect(fieldDisplayName("order_count")).toBe("order count");
  });

  it("leaves names people typed themselves alone", () => {
    expect(fieldDisplayName("Revenue")).toBe("Revenue");
    expect(fieldDisplayName("iPhoneSales")).toBe("iPhoneSales");
    expect(fieldDisplayName("year")).toBe("year");
  });
});
