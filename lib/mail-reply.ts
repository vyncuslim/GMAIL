import { extractEmail, migrateLegacyAddress, getMailAccount, type MailAccount } from "./mail-domains";

type ReplyMessage = {
  direction?: string;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  mailboxTo?: unknown;
  reply_to?: unknown;
  replyTo?: unknown;
  message_id?: unknown;
  headers?: unknown;
};

export function readHeader(headers: unknown, name: string): string {
  if (!headers || typeof headers !== "object") return "";
  if (Array.isArray(headers)) {
    const match = headers.find((h) => h && typeof h === "object" && String(h.name || h.key || "").toLowerCase() === name.toLowerCase());
    return match ? String(match.value || "") : "";
  }
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found ? String(found[1] || "") : "";
}

// Parse lists with quoted display names and angle addresses without extracting
// email-like text from a display name. Provider arrays are preferred.
export function replyAddresses(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(replyAddresses))];
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return replyAddresses(entry.email || entry.address || "");
  }
  if (typeof value !== "string") return [];
  const raw = value.replace(/\r?\n[ \t]+/g, " ");
  if (/[\r\n]/.test(raw)) return [];
  const pieces: string[] = [];
  let part = "", quoted = false, angle = false, escaped = false;
  for (const ch of raw) {
    if (escaped) { part += ch; escaped = false; continue; }
    if (quoted && ch === "\\") { part += ch; escaped = true; continue; }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle = true;
    else if (!quoted && ch === ">") angle = false;
    if (!quoted && !angle && ch === ",") { pieces.push(part); part = ""; }
    else part += ch;
  }
  pieces.push(part);
  return [...new Set(pieces.map((entry) => {
    const address = entry.trim();
    const wrapped = address.match(/^[^<>]*<([^<>]+)>$/);
    return extractEmail(wrapped?.[1] || address);
  }).filter(Boolean))];
}

const canonical = (value: string) => extractEmail(migrateLegacyAddress(value));
const unique = (values: string[]) => [...new Set(values.map(canonical).filter(Boolean))];

export function replyIdentity(message: ReplyMessage, account: MailAccount): string[] {
  const original = message.direction === "sent" ? message.from : message.mailboxTo ?? message.to;
  return unique(replyAddresses(original)).filter((email) => getMailAccount(email) === account);
}

export function buildReplyPlan(message: ReplyMessage, account: MailAccount, all: boolean) {
  const from = replyIdentity(message, account)[0] || "";
  const explicit = replyAddresses(message.reply_to).length
    ? replyAddresses(message.reply_to)
    : replyAddresses(message.replyTo).length
      ? replyAddresses(message.replyTo)
      : replyAddresses(readHeader(message.headers, "Reply-To"));
  const primary = message.direction === "sent" ? replyAddresses(message.to) : explicit.length ? explicit : replyAddresses(message.from);
  const to = unique(primary).filter((email) => email !== from);
  const cc = all ? unique([...replyAddresses(message.to), ...replyAddresses(message.cc)])
    .filter((email) => email !== from && !to.includes(email)) : [];
  // If the original message points only back to this mailbox, do not open a
  // deceptively addressed reply. No Bcc values are ever included in a reply.
  return { from, to, cc, canReply: Boolean(from && to.length), ...makeReplyHeaders(message) };
}

export function messageIds(value: unknown): string[] {
  if (typeof value !== "string" || !value || value.length > 50000) return [];
  const unfolded = value.replace(/\r?\n[ \t]+/g, " ").trim();
  if (/[\r\n]/.test(unfolded)) return [];
  const pattern = /<[^<>\s@]+@[^<>\s@]+>/g;
  const ids: string[] = unfolded.match(pattern) || [];
  if (!ids.length && /^[^<>\s@]+@[^<>\s@]+$/.test(unfolded)) ids.push("<" + unfolded + ">");
  return [...new Set(ids.filter((id) => id.length <= 320))];
}

export function makeReplyHeaders(message: ReplyMessage) {
  const inReplyTo = messageIds(message.message_id)[0] || messageIds(readHeader(message.headers, "Message-ID"))[0] || "";
  const earlier = messageIds(readHeader(message.headers, "References"));
  const parent = earlier.length ? earlier : messageIds(readHeader(message.headers, "In-Reply-To"));
  const references = inReplyTo ? [...new Set([...parent, inReplyTo])].slice(-20).join(" ") : "";
  return { inReplyTo, references };
}

export function safeReplyHeaders(inReplyTo: unknown, references: unknown): Record<string, string> {
  const id = messageIds(inReplyTo)[0];
  if (!id) return {};
  const ids = [...new Set([...messageIds(references).filter((x) => x !== id), id])].slice(-20);
  return { "In-Reply-To": id, References: ids.join(" ") };
}

// Only use subject fallback inside a shared mailbox and counterpart. Exact
// message identifiers are used whenever the provider returns reference headers.
export function sameThreadCandidate(a: ReplyMessage & { id: string; subject: string }, b: ReplyMessage & { id: string; subject: string }, account: MailAccount): boolean {
  if (a.id === b.id && a.direction === b.direction) return true;
  const ownA = replyIdentity(a, account);
  const ownB = replyIdentity(b, account);
  if (!ownA.some((email) => ownB.includes(email))) return false;
  const ids = (m: ReplyMessage) => new Set([
    ...messageIds(m.message_id), ...messageIds(readHeader(m.headers, "Message-ID")),
    ...messageIds(readHeader(m.headers, "In-Reply-To")), ...messageIds(readHeader(m.headers, "References")),
  ]);
  const ia = ids(a), ib = ids(b);
  if ([...ia].some((id) => ib.has(id))) return true;
  const subject = (v: string) => (v || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim().toLowerCase();
  const s = subject(a.subject);
  if (!s || s === "(no subject)" || s !== subject(b.subject)) return false;
  const others = (m: ReplyMessage, own: string[]) => unique([
    ...replyAddresses(m.from), ...replyAddresses(m.to), ...replyAddresses(m.cc),
  ]).filter((email) => !own.includes(email));
  const ob = others(b, ownB);
  return others(a, ownA).some((email) => ob.includes(email));
}
