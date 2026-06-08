// Sends outreach emails via Mail.app to viberank leads that have an email
// address and have NOT been emailed before. Dedup is by NORMALIZED EMAIL
// (lowercased + trimmed), never by github login — the same person can appear
// under differently-cased logins, and we must never email an address twice.
//
//   node scripts/outreach/send-emails.mjs                 # dry run, prints plan
//   node scripts/outreach/send-emails.mjs --send           # send up to the cap
//   node scripts/outreach/send-emails.mjs --send --limit 1 # test one
//
// X/LinkedIn are irrelevant to this script: if a lead has an email we email
// them here; DMs happen separately. sent.json is the permanent ledger.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toISOString().slice(0, 10);
const DATASET = path.join(HERE, "viberank-users.json");
const SENT = path.join(HERE, "sent.json");
const SUBJECT = "fellow dev - asking for feedback on a product";
const DO_SEND = process.argv.includes("--send");
const limIdx = process.argv.indexOf("--limit");
const DAILY_CAP = limIdx !== -1 ? Number(process.argv[limIdx + 1]) || 60 : 60;

const norm = (e) => e.trim().toLowerCase();
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

const data = JSON.parse(readFileSync(DATASET, "utf8"));
const sent = existsSync(SENT) ? JSON.parse(readFileSync(SENT, "utf8")) : {};

// Dedup source of truth = the actual Gmail Sent folder (emailed.json, written
// by sync-sent.mjs) UNION our agent log. emailed.json captures manual sends
// that sent.json never sees. Run `node scripts/outreach/sync-sent.mjs` first.
const EMAILED = path.join(HERE, "emailed.json");
if (!existsSync(EMAILED)) {
  console.error("emailed.json missing — run `node scripts/outreach/sync-sent.mjs` first to read your Gmail Sent folder.");
  process.exit(1);
}
const sentEmails = new Set([
  ...JSON.parse(readFileSync(EMAILED, "utf8")).map(norm),
  ...Object.values(sent).map((v) => norm(v.email)),
]);

function emailOf(u) {
  const c = (u.contacts ?? []).find((c) => c.type === "email");
  return c ? c.url.replace("mailto:", "") : null;
}

// Same dev-to-dev copy used in the queue. Deterministic by rank.
function draft(u) {
  const openers = [
    `saw that you are #${u.vrank} on viberank with ${usd(u.spend)} burned.`,
    `saw that you are #${u.vrank} on viberank, ${usd(u.spend)} burned. solid numbers.`,
  ];
  const middles = [
    `I built ccwarriors.xyz, same idea but it counts all your agents, Claude Code, Codex and 13 more. same local data, one curl and you are on it.`,
    `I built ccwarriors.xyz, it reads the same local data viberank does but counts every agent you use, not just Claude Code. one curl and you are on it.`,
  ];
  const closers = [
    `trying to get feedback from people who actually burn tokens. no pressure!`,
    `early days, so feedback from real users like you helps a lot. no pressure!`,
  ];
  return ["hey,", openers[u.vrank % 2], middles[u.vrank % 2], closers[u.vrank % 2], "best,\nManu"].join("\n\n");
}

// Build candidates: has email, email not already sent, dedup within the run too.
const seenThisRun = new Set();
const candidates = [];
for (const u of data) {
  const email = emailOf(u);
  if (!email) continue;
  const key = norm(email);
  if (sentEmails.has(key) || seenThisRun.has(key)) continue;
  seenThisRun.add(key);
  candidates.push({ ...u, email, key });
}

const sentToday = Object.values(sent).filter((s) => s.at?.startsWith(DATE)).length;
const room = Math.max(0, DAILY_CAP - sentToday);
const targets = candidates.slice(0, room);

console.log(`already emailed (unique addresses): ${sentEmails.size}`);
console.log(`remaining with email, never sent: ${candidates.length}`);
console.log(`sent today: ${sentToday} · cap ${DAILY_CAP} → sending now: ${targets.length}`);
for (const t of targets) console.log(`  #${t.vrank} ${t.name} <${t.email}>`);
if (candidates.length > targets.length) console.log(`  …${candidates.length - targets.length} more for the next day(s)`);

if (!DO_SEND) {
  console.log("\ndry run. add --send to actually send.");
  process.exit(0);
}

for (const t of targets) {
  const body = draft(t);
  const subj = SUBJECT.replaceAll('"', '\\"');
  const script = `
    tell application "Mail"
      set msg to make new outgoing message with properties {subject:"${subj}", content:"${body.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}", visible:false}
      tell msg to make new to recipient at end of to recipients with properties {address:"${t.email}"}
      send msg
    end tell`;
  try {
    execFileSync("osascript", ["-e", script], { stdio: "pipe" });
    // key by normalized email so future runs can never double-send this address
    sent[t.key] = { email: t.email, github: t.github, at: new Date().toISOString(), via: "mail.app" };
    sentEmails.add(t.key);
    writeFileSync(SENT, JSON.stringify(sent, null, 2) + "\n");
    console.log(`sent → #${t.vrank} ${t.name} <${t.email}>`);
  } catch (err) {
    console.log(`FAILED → ${t.name}: ${String(err).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 45000 + Math.random() * 45000)); // slow drip
}

// Mail auto-saves a draft per outgoing message; Gmail syncs it a beat after
// send, so clean up once at the end (reliable) rather than racing each send.
// Named lookup `mailbox "Drafts"` resolves wrong for Gmail — enumerate instead.
await new Promise((r) => setTimeout(r, 3000));
const sweep = `
  tell application "Mail"
    set n to 0
    repeat with acct in accounts
      repeat with mb in mailboxes of acct
        if (name of mb) contains "Draft" then
          try
            set hits to (messages of mb whose subject contains "feedback on a product")
            repeat with di from (count of hits) to 1 by -1
              delete (item di of hits)
              set n to n + 1
            end repeat
          end try
        end if
      end repeat
    end repeat
    return n
  end tell`;
try {
  const n = execFileSync("osascript", ["-e", sweep], { encoding: "utf8" }).trim();
  console.log(`swept ${n} leftover draft(s)`);
} catch {
  console.log("draft sweep skipped (run scripts/outreach/sync-sent.mjs note: clear drafts manually if any)");
}
console.log("done.");
