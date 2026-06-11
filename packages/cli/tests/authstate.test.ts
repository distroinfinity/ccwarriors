import { describe, it, expect } from "vitest";
import { resolveAuthAction } from "../src/authstate.js";

describe("resolveAuthAction", () => {
  it("resumes when a different, non-null token is on disk", () => {
    expect(resolveAuthAction("old-token", "new-token")).toBe("resume");
  });
  it("pauses when the disk token is unchanged", () => {
    expect(resolveAuthAction("same-token", "same-token")).toBe("pause");
  });
  it("pauses when there is no token on disk", () => {
    expect(resolveAuthAction("old-token", null)).toBe("pause");
  });
});
