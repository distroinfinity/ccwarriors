import { describe, it, expect } from "vitest";
import { parseCodexLines } from "../src/sources/codex.js";

const line = (o: object) => JSON.stringify(o);

describe("parseCodexLines", () => {
  it("extracts cwd, model, window, prompts and assistant turns; never reads text", async () => {
    const lines = [
      line({ type: "session_meta", timestamp: "2026-06-29T12:00:00.000Z", payload: { session_id: "s1", cwd: "/abs/repo", originator: "codex-tui" } }),
      line({ type: "turn_context", timestamp: "2026-06-29T12:00:01.000Z", payload: { cwd: "/abs/repo", model: "gpt-5.5" } }),
      // Injected context arrives as a response_item user message — must NOT count.
      line({ type: "response_item", timestamp: "2026-06-29T12:00:01.500Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions SECRET-CONTEXT" }] } }),
      // The genuine human prompt is an event_msg/user_message.
      line({ type: "event_msg", timestamp: "2026-06-29T12:00:02.000Z", payload: { type: "user_message", message: "refactor the parser SECRET-PROMPT" } }),
      line({ type: "response_item", timestamp: "2026-06-29T12:00:05.000Z", payload: { type: "reasoning", summary: [] } }),
      line({ type: "response_item", timestamp: "2026-06-29T12:00:06.000Z", payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"sed -n 1,5p /abs/repo/secret.ts\"}" } }),
      line({ type: "response_item", timestamp: "2026-06-29T12:00:09.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done SECRET-OUTPUT" }] } }),
    ];
    const s = (await parseCodexLines(lines))!;
    expect(s.tool).toBe("codex");
    expect(s.cwd).toBe("/abs/repo");
    expect(s.model).toBe("gpt-5.5");
    expect(s.prompts).toBe(1); // only the event_msg user_message
    expect(s.assistantTurns).toBe(1); // only the assistant message
    expect(s.startMs).toBe(Date.parse("2026-06-29T12:00:00.000Z"));
    expect(s.endMs).toBe(Date.parse("2026-06-29T12:00:09.000Z"));
    expect(s.editedFiles).toEqual([]); // edits live in shell args → degrade
    expect(s.startHour).toBe(new Date("2026-06-29T12:00:00.000Z").getHours());
    // PRIVACY: no prompt/output/command text is ever retained.
    const json = JSON.stringify(s);
    expect(json).not.toContain("SECRET-PROMPT");
    expect(json).not.toContain("SECRET-OUTPUT");
    expect(json).not.toContain("SECRET-CONTEXT");
    expect(json).not.toContain("secret.ts");
  });

  it("picks the most-frequent model across turn_context records", async () => {
    const lines = [
      line({ type: "turn_context", timestamp: "2026-06-29T12:00:00.000Z", payload: { cwd: "/r", model: "gpt-5.5" } }),
      line({ type: "event_msg", timestamp: "2026-06-29T12:00:01.000Z", payload: { type: "user_message", message: "x" } }),
      line({ type: "turn_context", timestamp: "2026-06-29T12:00:02.000Z", payload: { model: "gpt-5.5" } }),
      line({ type: "turn_context", timestamp: "2026-06-29T12:00:03.000Z", payload: { model: "o3" } }),
      line({ type: "response_item", timestamp: "2026-06-29T12:00:04.000Z", payload: { type: "message", role: "assistant", content: [] } }),
    ];
    const s = (await parseCodexLines(lines))!;
    expect(s.model).toBe("gpt-5.5"); // 2 vs 1
  });

  it("is tolerant: skips garbage lines and returns null when no turns are found", async () => {
    expect(await parseCodexLines(["not json", line({ type: "session_meta", payload: { cwd: "/r" } })])).toBeNull();
    // A lone reasoning/function_call with no user/assistant turn is not a session.
    expect(await parseCodexLines([line({ type: "response_item", timestamp: "2026-06-29T12:00:00.000Z", payload: { type: "reasoning" } })])).toBeNull();
  });
});
