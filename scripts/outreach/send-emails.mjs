// Sends queued outreach emails via Mail.app for EMAIL-ONLY targets (no X,
// no telegram, no linkedin — those stay human). Logs to sent.json so the
// queue renders them as done and nobody ever gets emailed twice.
//
//   node scripts/outreach/send-emails.mjs           # dry run, prints plan
//   node scripts/outreach/send-emails.mjs --send    # actually sends
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATE = new Date().toISOString().slice(0, 10);
const QUEUE = path.join(HERE, `queue-${DATE}.html`);
const SENT = path.join(HERE, "sent.json");
const SUBJECT = "fellow dev - asking for feedback on a product";
const DO_SEND = process.argv.includes("--send");

const html = readFileSync(QUEUE, "utf8");
const sent = existsSync(SENT) ? JSON.parse(readFileSync(SENT, "utf8")) : {};

// parse cards out of the queue html
const cards = [...html.matchAll(/<div class="t" id="t(\d+)" data-key="([^"]+)">([\s\S]*?)<\/div>\n<\/div>/g)].map((m) => {
  const [, idx, key, body] = m;
  const unesc = (s) => s.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  const text = unesc(body.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? "");
  const email = body.match(/sendMail\('([^']+)'/)?.[1] ?? null;
  const hasOther = /href="https:\/\/(x\.com|t\.me|www\.linkedin\.com)/.test(body);
  const name = unesc(body.match(/<span>\d+\. ([^<·]+)/)?.[1]?.trim() ?? key);
  return { idx: Number(idx), key, name, text, email, hasOther };
});

const targets = cards.filter((c) => c.email && !c.hasOther && !sent[c.key]);
console.log(`email-only, not yet sent: ${targets.length}`);
for (const t of targets) console.log(`  ${t.name} <${t.email}>`);

if (!DO_SEND) {
  console.log("\ndry run. add --send to actually send.");
  process.exit(0);
}

for (const t of targets) {
  const script = `
    tell application "Mail"
      set msg to make new outgoing message with properties {subject:"${SUBJECT.replaceAll('"', '\\"')}", content:"${t.text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}", visible:false}
      tell msg to make new to recipient at end of to recipients with properties {address:"${t.email}"}
      send msg
    end tell`;
  try {
    execFileSync("osascript", ["-e", script], { stdio: "pipe" });
    sent[t.key] = { email: t.email, at: new Date().toISOString(), via: "mail.app" };
    writeFileSync(SENT, JSON.stringify(sent, null, 2) + "\n");
    console.log(`sent → ${t.name} <${t.email}>`);
  } catch (err) {
    console.log(`FAILED → ${t.name}: ${String(err).slice(0, 120)}`);
  }
  await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000)); // human pacing
}
console.log("done. regenerate the queue to see them marked sent.");
