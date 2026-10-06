import { Resend } from "resend";

export const MAIL_DOMAIN = "vyncuslim.com";

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

export function extractEmail(value: string) {
  const match = value.trim().match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

export function isAllowedSender(value: string) {
  const email = extractEmail(value);
  return /^[^\s@]+@vyncuslim\.com$/.test(email);
}

export function normalizeAddress(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeAddress);
  if (typeof value === "string") {
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    return (matches || [extractEmail(value)]).map((v) => v.toLowerCase());
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return normalizeAddress(obj.email || obj.address || "");
  }
  return [];
}

export function isDomainAddress(value: unknown) {
  return normalizeAddress(value).some((address) => address.endsWith("@vyncuslim.com"));
}

export function addressList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(addressList).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}
