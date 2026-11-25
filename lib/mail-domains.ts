// Browser-safe routing for the personal and company Resend accounts.
export const PERSONAL_DOMAINS = ["vyncuslim.com", "mail.vyncuslim.com"] as const;
export const VYNALTH_DOMAINS = ["vynalthai.com", "mail.vynalthai.com"] as const;
export const MAIL_DOMAINS = [...PERSONAL_DOMAINS, ...VYNALTH_DOMAINS] as const;
export type MailAccount = "personal" | "vynalth";
export type MailDomain = (typeof MAIL_DOMAINS)[number];
export const MAIL_DOMAIN = MAIL_DOMAINS[0];
const EMAIL_PATTERN = /^[^\s@<>,;"\\]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function extractEmail(value: string): string {
  if (/[\r\n]/.test(value)) return "";
  const raw = value.trim();
  const wrapped = raw.match(/^[^<>,;]*<([^<>]+)>$/);
  const address = (wrapped?.[1] || raw).trim().toLowerCase();
  return EMAIL_PATTERN.test(address) ? address : "";
}
export function getMailDomain(value: string): MailDomain | null {
  const domain = extractEmail(value).split("@")[1];
  return MAIL_DOMAINS.find((allowed) => allowed === domain) || null;
}
export function isAllowedSender(value: string): boolean {
  return getMailDomain(value) !== null;
}
export function normalizeAddress(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizeAddress);
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    return normalizeAddress(obj.email || obj.address || "");
  }
  if (typeof value !== "string") return [];
  const single = extractEmail(value);
  if (single) return [single];
  if (!/[<>\r\n]/.test(value) && value.includes(",")) {
    return value.split(",").map(extractEmail).filter(Boolean);
  }
  return [];
}
export function isDomainAddress(value: unknown, domain?: MailDomain): boolean {
  return normalizeAddress(value).some((email) => {
    const actual = getMailDomain(email);
    return actual !== null && (domain === undefined || actual === domain);
  });
}

export function getMailAccount(value: string): MailAccount | null {
  const domain = getMailDomain(value);
  if (!domain) return null;
  return domain === "vynalthai.com" || domain === "mail.vynalthai.com" ? "vynalth" : "personal";
}

export function isAccountAddress(value: unknown, account: MailAccount): boolean {
  return normalizeAddress(value).some((email) => getMailAccount(email) === account);
}

// Personal IDs remain unchanged to preserve existing local labels and drafts.
export function encodeMailId(account: MailAccount, id: string): string {
  return account === "personal" ? id : "vynalth:" + id;
}

export function decodeMailId(value: unknown): { account: MailAccount; id: string } | null {
  if (typeof value !== "string") return null;
  const account: MailAccount = value.startsWith("vynalth:") ? "vynalth" : "personal";
  const id = account === "vynalth" ? value.slice("vynalth:".length) : value;
  return /^[A-Za-z0-9_-]+$/.test(id) ? { account, id } : null;
}

// Wildcards match the exact company domain, not suffixes or arbitrary subdomains.
export function matchesVynalthMailbox(value: unknown, rules: string): boolean {
  const allowed = new Set(rules.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  return normalizeAddress(value).some((email) => {
    if (getMailAccount(email) !== "vynalth") return false;
    return allowed.has(email) || allowed.has("*@" + getMailDomain(email));
  });
}
