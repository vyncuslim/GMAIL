import { Resend } from "resend";
import { getMailAccount, isAccountAddress, matchesVynalthMailbox, type MailAccount } from "./mail-domains";
export * from "./mail-domains";

export function getResend(account: MailAccount = "personal") {
  const key = account === "personal" ? process.env.RESEND_API_KEY : process.env.RESEND_VYNALTH_API_KEY;
  if (!key || (account === "vynalth" && !process.env.VYNALTH_MAILBOX_ADDRESSES?.trim())) {
    throw new Error(account === "vynalth" ? "Vynalth AI mail is not configured" : "Personal mail is not configured");
  }
  return new Resend(key);
}

export function isVynalthConfigured() {
  return Boolean(process.env.RESEND_VYNALTH_API_KEY && process.env.VYNALTH_MAILBOX_ADDRESSES?.trim());
}

export function canAccessMailbox(value: unknown, account: MailAccount): boolean {
  return account === "personal" ? isAccountAddress(value, account) : isVynalthConfigured() && matchesVynalthMailbox(value, process.env.VYNALTH_MAILBOX_ADDRESSES || "");
}

export function resolveSender(from: string): MailAccount | null {
  const account = getMailAccount(from);
  return account && canAccessMailbox(from, account) ? account : null;
}

export function addressList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(addressList).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/[;,\n]/).map((v) => v.trim()).filter(Boolean);
}
