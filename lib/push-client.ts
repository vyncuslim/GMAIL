export type PushAccount = "personal" | "vynalth";

export type PushConfiguration = {
  enabled: boolean;
  publicKey: string;
  accounts: PushAccount[];
};

const PREFERENCE_KEY = "vmail_push_preference_v1";
let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;

export class PushClientError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    super(code);
    this.name = "PushClientError";
  }
}

async function notificationRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`/api/notifications/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data !== "object") {
      throw new PushClientError(
        response.status === 401 ? "AUTH_REQUIRED" : typeof data?.code === "string" ? data.code : "REQUEST_FAILED",
        response.status,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof PushClientError) throw error;
    throw new PushClientError("NETWORK_ERROR");
  } finally {
    window.clearTimeout(timeout);
  }
}

export function publicKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]{87}={0,2}$/.test(value)) throw new PushClientError("INVALID_CONFIGURATION");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  let decoded: string;
  try {
    decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  } catch {
    throw new PushClientError("INVALID_CONFIGURATION");
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw new PushClientError("INVALID_CONFIGURATION");
  return bytes;
}

export async function getPushConfiguration(): Promise<PushConfiguration> {
  const data = await notificationRequest<PushConfiguration>("config");
  if (typeof data.enabled !== "boolean") throw new PushClientError("INVALID_CONFIGURATION");
  if (!data.enabled) return { enabled: false, publicKey: "", accounts: [] };
  if (!Array.isArray(data.accounts) || !data.accounts.length ||
    data.accounts.some((account) => account !== "personal" && account !== "vynalth")) {
    throw new PushClientError("INVALID_CONFIGURATION");
  }
  publicKeyBytes(data.publicKey);
  return { ...data, accounts: [...new Set(data.accounts)] };
}

export function registerMailServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!registrationPromise) {
    registrationPromise = (async () => {
      if (!("serviceWorker" in navigator) || !window.isSecureContext) {
        throw new PushClientError("UNSUPPORTED");
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      if (registration.active) return registration;
      await new Promise<void>((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) { reject(new PushClientError("WORKER_UNAVAILABLE")); return; }
        const finish = () => {
          window.clearTimeout(timer);
          worker.removeEventListener("statechange", onChange);
        };
        const onChange = () => {
          if (worker.state === "activated") { finish(); resolve(); }
          else if (worker.state === "redundant") { finish(); reject(new PushClientError("WORKER_UNAVAILABLE")); }
        };
        const timer = window.setTimeout(() => { finish(); reject(new PushClientError("WORKER_UNAVAILABLE")); }, 12_000);
        worker.addEventListener("statechange", onChange);
        onChange();
      });
      return registration;
    })().catch((error) => {
      registrationPromise = undefined;
      throw error;
    });
  }
  return registrationPromise;
}

export function subscriptionUsesKey(subscription: PushSubscription, key: string): boolean {
  const existing = subscription.options.applicationServerKey;
  if (!existing) return false;
  const expected = publicKeyBytes(key);
  const actual = new Uint8Array(existing);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function notificationsOptedOut(): boolean {
  try { return localStorage.getItem(PREFERENCE_KEY) === "off"; } catch { return false; }
}

export function setNotificationPreference(enabled: boolean): void {
  try { localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off"); } catch {}
}

export async function savePushSubscription(subscription: PushSubscription, accounts: PushAccount[]) {
  const result = await notificationRequest<{ ok: boolean; accounts: PushAccount[] }>("subscription", "POST", {
    subscription: subscription.toJSON(), accounts,
  });
  if (result.ok !== true) throw new PushClientError("REQUEST_FAILED");
  setNotificationPreference(true);
  return result;
}

export async function getPushSubscriptionStatus(subscription: PushSubscription) {
  const result = await notificationRequest<{ subscribed: boolean; accounts: PushAccount[] }>("status", "POST", {
    endpoint: subscription.endpoint,
  });
  if (typeof result.subscribed !== "boolean") throw new PushClientError("REQUEST_FAILED");
  return result;
}

export async function sendPushTest(subscription: PushSubscription): Promise<void> {
  const result = await notificationRequest<{ ok: boolean; accepted: boolean }>("test", "POST", {
    endpoint: subscription.endpoint,
  });
  if (result.ok !== true || result.accepted !== true) throw new PushClientError("REQUEST_FAILED");
}

export async function removePushSubscription(subscription: PushSubscription): Promise<boolean> {
  let serverRemoved = false;
  try {
    const result = await notificationRequest<{ ok: boolean }>("subscription", "DELETE", { endpoint: subscription.endpoint });
    serverRemoved = result.ok === true;
  } catch { /* Browser revocation still prevents delivery if the server is temporarily unreachable. */ }
  let browserRemoved = false;
  try { browserRemoved = await subscription.unsubscribe(); } catch {}
  if (!serverRemoved && !browserRemoved) throw new PushClientError("UNSUBSCRIBE_FAILED");
  return browserRemoved;
}

export async function disableCurrentDevicePush(): Promise<void> {
  setNotificationPreference(false);
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) return;
  registration.active?.postMessage({ type: "CLOSE_MAIL_NOTIFICATIONS" });
  if (!("pushManager" in registration)) return;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) await removePushSubscription(subscription);
}

export function pushErrorMessage(error: unknown): string {
  if (error instanceof PushClientError) {
    if (error.code === "AUTH_REQUIRED") return "登录已过期，请重新登录后启用通知。";
    if (error.code === "UNSUBSCRIBE_FAILED") return "暂时无法关闭此设备通知，请保持联网后重试。";
    if (error.code === "INVALID_CONFIGURATION") return "通知服务配置尚未就绪，请稍后重试。";
    if (error.code === "UNSUPPORTED") return "此浏览器暂不支持后台推送，请使用支持的浏览器。";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "通知未获允许。请检查浏览器或系统通知设置后重试。";
  }
  return "暂时无法连接通知服务，请保持联网并重试。";
}
