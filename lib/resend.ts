import { Resend } from "resend";
export { MAIL_DOMAIN, MAIL_DOMAINS, extractEmail, isAllowedSender, normalizeAddress, isDomainAddress } from "./mail-domains";

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

export function addressList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(addressList).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
