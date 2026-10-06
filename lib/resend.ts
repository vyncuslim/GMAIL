import { Resend } from "resend";

export const MAIL_DOMAIN = "vyncuslim.com";

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

export function isAllowedSender(value: string) {
  const address = value.trim().toLowerCase();
  return /^[^\s@]+@vyncuslim\.com$/.test(address);
}
