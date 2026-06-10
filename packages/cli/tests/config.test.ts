import { describe, expect, it } from "vitest";
import { deriveMachineId, ensureMachineId } from "../src/config.js";

describe("deriveMachineId", () => {
  it("is deterministic for the same machine seed", () => {
    expect(deriveMachineId("host|user|darwin|arm64")).toBe(deriveMachineId("host|user|darwin|arm64"));
  });

  it("changes when the machine seed changes", () => {
    expect(deriveMachineId("host-a|user|darwin|arm64")).not.toBe(deriveMachineId("host-b|user|darwin|arm64"));
  });

  it("returns a 16-char lowercase hex id", () => {
    expect(deriveMachineId("anything")).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("ensureMachineId", () => {
  it("preserves an existing stored machine id", async () => {
    await expect(ensureMachineId({ token: "tok", login: "warrior", machineId: "aabbccddeeff0011" })).resolves.toBe(
      "aabbccddeeff0011",
    );
  });
});
