import { decodeMailId } from "./mail-domains";

// Only a mailbox message can be carried through login. Never accept arbitrary
// next URLs: the form can be edited and notification links may be forwarded.
export function notificationDestination(value: unknown): string {
  if (typeof value !== "string" || value.length > 160 || !decodeMailId(value)) return "/";
  return "/?" + new URLSearchParams({ notification: value }).toString();
}

export function safeMailReturn(value: unknown): string {
  if (value === "/") return "/";
  if (typeof value !== "string" || value.length > 600 || !value.startsWith("/?") || /[\\\r\n]/.test(value)) return "/";
  const params = new URLSearchParams(value.slice(2));
  if ([...params.keys()].length !== 1 || !params.has("notification")) return "/";
  return notificationDestination(params.get("notification"));
}

export function loginDestination(next: string, error?: string): string {
  const params = new URLSearchParams();
  if (error) params.set("error", error);
  const safe = safeMailReturn(next);
  if (safe !== "/") params.set("next", safe);
  const query = params.toString();
  return "/login" + (query ? "?" + query : "");
}
