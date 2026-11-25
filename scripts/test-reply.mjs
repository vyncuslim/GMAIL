import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Compile the pure TypeScript helpers in memory without a test dependency.
const asModule = async (path, replacements = {}) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [specifier, url] of Object.entries(replacements)) {
    js = js.replaceAll('"' + specifier + '"', JSON.stringify(url));
  }
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
};
const domains = await asModule("../lib/mail-domains.ts");
const m = await import(await asModule("../lib/mail-reply.ts", { "./mail-domains": domains }));
const base = {
  direction: "inbox", from: "Customer <customer@example.net>", to: ["support@sleepsomno.com"],
  mailboxTo: ["support@vynalthai.com"], cc: ["colleague@example.net", "support@sleepsomno.com", "billing@vynalthai.com"],
  bcc: ["hidden@example.net"], reply_to: [], message_id: "<msg-1@example.net>",
  headers: { References: "<original@example.net> <msg-1@example.net>" },
};
let n = 0;
function test(name, fn) { fn(); n++; console.log("PASS " + name); }
test("empty Reply-To falls back to original sender", () => {
  const p = m.buildReplyPlan(base, "vynalth", false);
  assert.deepEqual(p.to, ["customer@example.net"]);
  assert.equal(p.from, "support@vynalthai.com");
  assert.equal(p.canReply, true);
  assert.deepEqual(p.cc, []);
});
test("explicit Reply-To wins over From", () => assert.deepEqual(
  m.buildReplyPlan({ ...base, reply_to: ["desk@example.org"] }, "vynalth", false).to, ["desk@example.org"]));
test("header Reply-To fallback handles display names", () => assert.deepEqual(
  m.buildReplyPlan({ ...base, headers: { "Reply-To": '"Doe, Jane" <desk@example.org>' } }, "vynalth", false).to, ["desk@example.org"]));
test("reply all retains legitimate company Cc and excludes self, Bcc and duplicates", () => {
  const p = m.buildReplyPlan({ ...base, cc: [...base.cc, "customer@example.net", "colleague@example.net"] }, "vynalth", true);
  assert.deepEqual(p.cc, ["colleague@example.net", "billing@vynalthai.com"]);
  assert.ok(!p.to.includes("hidden@example.net") && !p.cc.includes("hidden@example.net"));
});
test("legacy subdomain maps to the new mail subdomain", () => {
  const p = m.buildReplyPlan({ ...base, mailboxTo: undefined, to: ["auth@mail.sleepsomno.com"] }, "vynalth", false);
  assert.equal(p.from, "auth@mail.vynalthai.com");
});
test("new enterprise subdomain preserves exact receiving identity", () => {
  const p = m.buildReplyPlan({ ...base, mailboxTo: ["notifications@mail.vynalthai.com"] }, "vynalth", false);
  assert.equal(p.from, "notifications@mail.vynalthai.com");
});
test("personal identity cannot be used for a company reply", () => assert.equal(m.buildReplyPlan(base, "personal", false).canReply, false));
test("sent message reply targets recipient, not self", () => {
  const p = m.buildReplyPlan({ direction: "sent", from: "vyncus@vyncuslim.com", to: ["other@example.net"] }, "personal", false);
  assert.equal(p.from, "vyncus@vyncuslim.com");
  assert.deepEqual(p.to, ["other@example.net"]);
});
test("explicit empty authorized mailbox list fails closed", () => assert.equal(m.buildReplyPlan({ ...base, mailboxTo: [] }, "vynalth", false).canReply, false));
test("self-only reply is disabled", () => assert.equal(m.buildReplyPlan({ ...base, from: "support@vynalthai.com" }, "vynalth", false).canReply, false));
test("thread reference headers preserve original Message-ID and deduplicate", () => {
  const p = m.buildReplyPlan(base, "vynalth", false);
  assert.deepEqual(m.safeReplyHeaders(p.inReplyTo, p.references), { "In-Reply-To": "<msg-1@example.net>", References: "<original@example.net> <msg-1@example.net>" });
});
test("header-only Message-ID and folded References are supported", () => {
  const p = m.makeReplyHeaders({ headers: { "Message-ID": "<child@example.net>", "References": "<root@example.net>\r\n <parent@example.net>" } });
  assert.equal(p.references, "<root@example.net> <parent@example.net> <child@example.net>");
});
test("header injection and non-message IDs are rejected", () => {
  assert.deepEqual(m.safeReplyHeaders("<abc@example.net>\r\nBcc: attacker@example.net", ""), {});
  assert.deepEqual(m.safeReplyHeaders("resend-api-uuid", ""), {});
});
test("quoted display names do not produce false recipients", () => assert.deepEqual(
  m.replyAddresses('"fake@example.org, Jane" <real@example.net>, other@example.net'), ["real@example.net", "other@example.net"]));
test("same subject in different mailboxes is not combined", () => {
  const a = { ...base, id: "a", subject: "Question" };
  const b = { ...base, id: "b", subject: "Question", mailboxTo: ["billing@vynalthai.com"] };
  assert.equal(m.sameThreadCandidate(a, b, "vynalth"), false);
});
test("same mailbox and same correspondent can use subject fallback", () => {
  const a = { ...base, id: "a", subject: "Question" };
  const b = { ...base, id: "b", subject: "Re: Question", message_id: "<other@example.net>", headers: {} };
  assert.equal(m.sameThreadCandidate(a, b, "vynalth"), true);
});
test("unrelated counterpart and reused subject do not form a thread", () => {
  const a = { ...base, id: "a", subject: "Question", cc: [], headers: {}, message_id: "<a@example.net>" };
  const b = { ...a, id: "b", from: "unrelated@example.org", message_id: "<b@example.net>" };
  assert.equal(m.sameThreadCandidate(a, b, "vynalth"), false);
});
console.log(n + " reply regression tests passed");
