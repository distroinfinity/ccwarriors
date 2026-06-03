import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

// Fallback installer endpoints — served from Railway (get.ccwarriors.xyz) so
// installs keep working even when the Vercel domain is challenge-gated.
describe("installer fallback endpoints", () => {
  const app = createApp();

  it("GET /install.sh serves the bash installer with BASE rewritten to the serving host", async () => {
    const res = await app.request("https://get.ccwarriors.xyz/install.sh");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("shellscript");
    const body = await res.text();
    expect(body.startsWith("#!/usr/bin/env bash")).toBe(true);
    // The default BASE must point at the host that served the script, so the
    // cli.js download doesn't bounce back to the (possibly blocked) primary.
    expect(body).toContain('BASE="${CCWARRIORS_BASE:-https://get.ccwarriors.xyz}"');
  });

  it("GET /install.ps1 serves the PowerShell installer with Base rewritten", async () => {
    const res = await app.request("https://get.ccwarriors.xyz/install.ps1");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("CCWarriors CLI installer (Windows PowerShell)");
    expect(body).toContain('else { "https://get.ccwarriors.xyz" }');
  });

  it("GET /cli.js serves the built CLI bundle", async () => {
    const res = await app.request("https://get.ccwarriors.xyz/cli.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("honors x-forwarded headers from the Railway proxy", async () => {
    const res = await app.request("http://internal:8080/install.sh", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "get.ccwarriors.xyz" },
    });
    const body = await res.text();
    expect(body).toContain('BASE="${CCWARRIORS_BASE:-https://get.ccwarriors.xyz}"');
  });
});
