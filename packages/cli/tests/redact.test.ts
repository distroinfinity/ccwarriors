import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

// Client-side secret stripping — the gate every piece of TEXT passes through
// before leaving the machine (topPrompt + transcripts). Over-redaction is the
// safe failure mode; under-redaction is a breach.

const MASK = "▮▮▮";

describe("redact", () => {
  it.each([
    ["anthropic key", "use sk-ant-api03-" + "AbCdEf0123456789AbCdEf0123456789" + " for auth", "sk-ant"],
    ["openai-style key", "OPENAI sk-AbCdEf0123456789AbCdEf0123456789" + "T3BlbkFJx", "sk-"],
    ["github classic token", "push with ghp_" + "AbCdEfGh0123456789AbCdEfGh0123456789", "ghp_"],
    ["github fine-grained", "github_pat_" + "11ABCDEFG0_abcdefghijklmnopqrstuvwxyz0123456789", "github_pat_"],
    ["aws access key", "creds AKIA" + "IOSFODNN7EXAMPLE" + " here", "AKIA"],
    ["jwt", "bearer eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiIxIn0." + "dBjftJeZ4CVP" + "-mB92K27uhbU" + "JU1p1r_wW1gFWFOEjXk", "eyJ"],
    ["long hex secret", "salt 0123456789abcdef" + "0123456789abcdef01234567", "0123456789abcdef0123"],
    ["email", "mail me at dev@example.com about it", "@example.com"],
    ["env assignment", "set DATABASE_PASSWORD=" + "hunter2" + "hunter2 in prod", "hunter2"],
    ["url credentials", ["postgres", "://", "admin", ":", "s3cret", "pw", "@", "db.host", ":5432/app"].join(""), "s3cretpw"],
  ])("strips %s", (_name, input, mustNotSurvive) => {
    const out = redact(input);
    expect(out).not.toContain(mustNotSurvive);
    expect(out).toContain(MASK);
  });

  it("leaves ordinary prompts untouched", () => {
    for (const text of [
      "implement the plan",
      "fix the failing test in auth.spec.ts",
      "continue mb",
      "make the button terracotta like the mockup",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  it("handles multiple secrets in one string", () => {
    const out = redact("key ghp_" + "AbCdEfGh0123456789AbCdEfGh0123456789" + " and mail a@b.co");
    expect(out).not.toContain("ghp_AbCdEfGh");
    expect(out).not.toContain("a@b.co");
  });
});
