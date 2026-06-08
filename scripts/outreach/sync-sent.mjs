// Reads EVERY recipient address from the Gmail Sent folder (via Mail.app) and
// writes them to emailed.json. This is the authoritative "already emailed"
// ledger — it captures manual sends too, which sent.json (agent-only) misses.
// Run before any bulk send so dedup reflects reality.
//
//   node scripts/outreach/sync-sent.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const applescript = `
tell application "Mail"
  set out to ""
  repeat with acct in accounts
    try
      set sm to mailbox "Sent" of acct
      set msgs to messages of sm
      repeat with m in msgs
        try
          repeat with r in (to recipients of m)
            set out to out & (address of r) & linefeed
          end repeat
          repeat with r in (cc recipients of m)
            set out to out & (address of r) & linefeed
          end repeat
        end try
      end repeat
    end try
  end repeat
  return out
end tell`;

console.log("reading Gmail Sent folder via Mail.app (may take ~30-60s)…");
const raw = execFileSync("osascript", ["-e", applescript], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const addrs = [...new Set(raw.split("\n").map((s) => s.trim().toLowerCase()).filter((s) => s.includes("@")))];
addrs.sort();
writeFileSync(path.join(HERE, "emailed.json"), JSON.stringify(addrs, null, 1) + "\n");
console.log(`emailed.json written: ${addrs.length} unique addresses ever sent to`);
