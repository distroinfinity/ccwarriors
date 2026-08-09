import { describe, it, expect } from "vitest";
import { parseAiderLog, clusterAiderCommits, AIDER_SESSION_GAP_MS, type AiderCommit } from "../src/sources/aider.js";

// Mirror the wire format the real git produces for AIDER_LOG_FORMAT:
//   <HDR>%H \t %aI \t <coauthor-trailer-values joined by the unit separator>
//   <numstat rows>  added \t deleted \t path
const HDR = "\x01A\x01";
const hdr = (sha: string, iso: string, coauthors: string) => `${HDR}${sha}\t${iso}\t${coauthors}`;
const file = (a: number, d: number, p: string) => `${a}\t${d}\t${p}`;

describe("parseAiderLog", () => {
  it("keeps only aider-trailer commits and extracts dates, files, model", () => {
    const stdout = [
      hdr("aaa", "2026-06-20T10:00:00+00:00", "aider (gpt-4o) <aider@aider.chat>"),
      file(10, 0, "src/widget.ts"),
      file(2, 1, "src/util.ts"),
      hdr("bbb", "2026-06-20T11:00:00+00:00", "Jane Dev <jane@example.com>"), // not aider
      file(5, 0, "src/other.ts"),
      hdr("ccc", "2026-06-20T12:00:00+00:00", "aider <noreply@aider.chat>"), // aider, no model
      file(1, 0, "README.md"),
    ].join("\n");
    const commits = parseAiderLog(stdout);
    expect(commits.length).toBe(2);
    expect(commits[0]!.files).toEqual(["src/widget.ts", "src/util.ts"]);
    expect(commits[0]!.model).toBe("gpt-4o");
    expect(commits[1]!.model).toBeNull();
    expect(commits[0]!.dateMs).toBe(Date.parse("2026-06-20T10:00:00+00:00"));
  });

  it("is tolerant of empty / malformed output", () => {
    expect(parseAiderLog("")).toEqual([]);
    expect(parseAiderLog("garbage\nno header here")).toEqual([]);
  });
});

describe("clusterAiderCommits", () => {
  const at = (min: number, files: string[], model: string | null = null): AiderCommit => ({
    dateMs: Date.parse("2026-06-20T10:00:00Z") + min * 60_000,
    files,
    model,
  });

  it("groups commits within the gap into one session and splits across it", () => {
    const commits = [
      at(0, ["a.ts"], "gpt-4o"),
      at(10, ["b.ts"]), // +10min → same cluster
      at(120, ["c.ts"]), // +110min → new cluster
    ];
    const sessions = clusterAiderCommits(commits, "/repo");
    expect(sessions.length).toBe(2);
    expect(sessions[0]!.tool).toBe("aider");
    expect(sessions[0]!.cwd).toBe("/repo");
    expect(sessions[0]!.assistantTurns).toBe(2); // two commits
    expect(sessions[0]!.editedFiles.sort()).toEqual(["a.ts", "b.ts"]);
    expect(sessions[0]!.model).toBe("gpt-4o"); // first non-null model in cluster
    expect(sessions[0]!.startMs).toBe(at(0, []).dateMs);
    expect(sessions[0]!.endMs).toBe(at(10, []).dateMs);
    expect(sessions[1]!.assistantTurns).toBe(1);
    expect(AIDER_SESSION_GAP_MS).toBe(30 * 60 * 1000);
  });

  it("returns [] for no commits", () => {
    expect(clusterAiderCommits([], "/repo")).toEqual([]);
  });
});
