import { groupLabel, timeAgo, STATUS_META } from "@/lib/format";
import { qs } from "@/lib/api";

describe("format", () => {
  it("relative time in German", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(timeAgo("2026-01-10T11:48:00Z", now)).toBe("vor 12 Min.");
    expect(timeAgo("2026-01-10T09:00:00Z", now)).toBe("vor 3 Std.");
    expect(timeAgo("2026-01-08T12:00:00Z", now)).toBe("vor 2 Tagen");
  });
  it("independence group labels", () => {
    expect(groupLabel("wire:reuters")).toBe("Agentur: REUTERS");
    expect(groupLabel("owner:ard")).toBe("Medienhaus: ard");
  });
  it("UNCONFIRMED is explained as not false", () => {
    expect(STATUS_META.UNCONFIRMED.help).toMatch(/nicht, dass sie falsch ist/);
  });
  it("query string skips empty values", () => {
    expect(qs({ a: "1", b: "", c: undefined, d: 0 })).toBe("?a=1&d=0");
  });
});
