import { Resend } from "resend";

export function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

export function senderAddress() {
  const value = process.env.MAIL_FROM;
  if (!value) throw new Error("MAIL_FROM is not configured");
  if (!value.toLowerCase().endsWith("@vyncuslim.com")) {
    throw new Error("MAIL_FROM must use the @vyncuslim.com domain");
  }
  return value;
}
