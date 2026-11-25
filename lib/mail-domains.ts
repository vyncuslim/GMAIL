// Shared, browser-safe allowlist for the two personal mail domains.
export const MAIL_DOMAINS = ["vyncuslim.com", "mail.vyncuslim.com"] as const;
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
