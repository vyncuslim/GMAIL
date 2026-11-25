import { createECDH, createHash, ECDH, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Webhook } from 'svix';
import { generateRequestDetails } from 'web-push';

export const APP_ORIGIN = 'https://mail.vyncuslim.com';
const OWNER = 'mail-owner';
const ACCOUNTS = ['personal', 'vynalth'];
const DAY = 86_400_000;
const MAX_DEVICES = 20;
const MAX_ATTEMPTS = 12;
const LEASE_MS = 30_000;
const FETCH_TIMEOUT_MS = 4_000;
const RECIPIENT_DOMAINS = {
  personal: new Set(['vyncuslim.com', 'mail.vyncuslim.com']),
  vynalth: new Set([
    'vynalthai.com', 'mail.vynalthai.com', 'sleepsomno.com',
    'mail.sleepsomno.com', 'www.sleepsomno.com', 'vitashield.sleepsomno.com',
  ]),
};

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function b64url(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== length || decoded.toString('base64url') !== value) return null;
  return decoded;
}

function validPoint(value) {
  const bytes = b64url(value, 65);
  if (!bytes || bytes[0] !== 4) return false;
  try {
    return Buffer.from(ECDH.convertKey(bytes, 'prime256v1')).equals(bytes);
  } catch {
    return false;
  }
}

function webhookSecret(env, account) {
  return account === 'personal' ? env.RESEND_WEBHOOK_SECRET_PERSONAL : env.RESEND_WEBHOOK_SECRET_VYNALTH;
}

function validWebhookSecret(value) {
  if (typeof value !== 'string' || !/^whsec_[A-Za-z0-9+/=_-]{20,256}$/.test(value)) return false;
  const length = Buffer.from(value.slice(6), 'base64').length;
  return length >= 16 && length <= 64;
}

async function requireReady(env) {
  let valid = env.APP_ORIGIN === APP_ORIGIN && env.VAPID_SUBJECT === APP_ORIGIN
    && !!env.DB && validPoint(env.VAPID_PUBLIC_KEY)
    && ACCOUNTS.every((account) => validWebhookSecret(webhookSecret(env, account)));
  const privateKey = b64url(env.VAPID_PRIVATE_KEY, 32);
  if (valid && privateKey) {
    try {
      const curve = createECDH('prime256v1');
      curve.setPrivateKey(privateKey);
      valid = timingSafeEqual(curve.getPublicKey(), Buffer.from(env.VAPID_PUBLIC_KEY, 'base64url'));
    } catch { valid = false; }
  } else { valid = false; }
  if (valid) {
    try {
      const row = await env.DB.prepare("SELECT value FROM push_meta WHERE key = 'schema_version'").first();
      valid = row?.value === '1';
      // Catch partial or incorrectly applied migrations before advertising readiness.
      await env.DB.prepare('SELECT id, endpoint_hash, last_test_at FROM push_subscriptions LIMIT 0').all();
      await env.DB.prepare('SELECT id, snapshot_ready, expires_at FROM push_events LIMIT 0').all();
      await env.DB.prepare('SELECT event_id, state, lease_until, attempts FROM push_deliveries LIMIT 0').all();
    } catch { valid = false; }
  }
  if (!valid) throw new HttpError(503, 'SERVICE_NOT_READY', '通知服务尚未完成配置，请稍后重试。');
}

export function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value || /[\x00-\x20\x7f\\]/.test(value)) {
    throw new HttpError(400, 'INVALID_SUBSCRIPTION', '设备推送订阅格式无效。');
  }
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'INVALID_SUBSCRIPTION', '设备推送订阅格式无效。'); }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'fcm.googleapis.com' || host === 'android.googleapis.com'
    || host === 'push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
    || host.endsWith('.push.apple.com')
    || host.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('#') || url.port || !allowed || url.pathname === '/') {
    throw new HttpError(400, 'INVALID_SUBSCRIPTION', '设备推送订阅格式无效。');
  }
  return url.href;
}

function parseAccounts(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 || value.some((account) => !ACCOUNTS.includes(account))) {
    throw new HttpError(400, 'INVALID_ACCOUNTS', '请选择有效的邮箱通知。');
  }
  return ACCOUNTS.filter((account) => value.includes(account));
}

function accountList(row) {
  return row ? ACCOUNTS.filter((account) => row[account] === 1) : [];
}

async function readText(request, limit) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大。');
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', '请求内容过大。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new HttpError(400, 'INVALID_BODY', '请求格式无效。'); }
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'JSON_REQUIRED', '请使用 JSON 格式。');
  }
  try {
    const value = JSON.parse(await readText(request, 8192));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_BODY', '请求格式无效。');
  }
}

async function authenticate(request, fetchImpl) {
  if (request.headers.get('origin') !== APP_ORIGIN) {
    throw new HttpError(403, 'INVALID_ORIGIN', '请从邮箱应用管理通知。');
  }
  const cookies = request.headers.get('cookie') || '';
  if (cookies.length > 8192) throw new HttpError(401, 'AUTH_REQUIRED', '请先登录邮箱。');
  const values = cookies.split(';').map((part) => part.trim()).filter((part) => part.startsWith('vmail_session='));
  if (values.length !== 1 || !/^vmail_session=vyncuslim-mail\.[a-f0-9]{64}$/.test(values[0])) {
    throw new HttpError(401, 'AUTH_REQUIRED', '请先登录邮箱。');
  }
  const headers = new Headers({ Cookie: values[0], Accept: 'application/json' });
  const agent = request.headers.get('user-agent');
  if (agent && agent.length <= 2048) headers.set('user-agent', agent);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(APP_ORIGIN + '/api/auth/status', {
      method: 'GET', headers, redirect: 'manual', cache: 'no-store', signal: controller.signal,
    });
    if (response.status !== 200) throw new Error();
    const value = JSON.parse(await readText(response, 4096));
    if (value?.authenticated !== true) {
      throw new HttpError(401, 'AUTH_REQUIRED', '登录已过期，请重新登录邮箱。');
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) throw error;
    throw new HttpError(503, 'AUTH_UNAVAILABLE', '暂时无法验证登录，请稍后重试。');
  } finally { clearTimeout(timeout); }
}

function validateSubscription(value, now) {
  if (!value || typeof value !== 'object' || !value.keys || !validPoint(value.keys.p256dh) || !b64url(value.keys.auth, 16)) {
    throw new HttpError(400, 'INVALID_SUBSCRIPTION', '设备推送订阅格式无效。');
  }
  const endpoint = normalizeEndpoint(value.endpoint);
  const expiration = value.expirationTime ?? null;
  if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= now)) {
    throw new HttpError(400, 'EXPIRED_SUBSCRIPTION', '设备推送订阅已过期，请重新开启通知。');
  }
  return { endpoint, expiration, p256dh: value.keys.p256dh, auth: value.keys.auth };
}

async function saveSubscription(db, body, now) {
  const accounts = parseAccounts(body.accounts);
  const subscription = validateSubscription(body.subscription, now);
  const hash = digest(subscription.endpoint);
  await db.prepare('DELETE FROM push_subscriptions WHERE expiration_at IS NOT NULL AND expiration_at <= ?').bind(now).run();
  const row = await db.prepare(`
    INSERT INTO push_subscriptions
      (id, owner_id, endpoint_hash, endpoint, p256dh, auth, expiration_at, personal, vynalth, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint_hash = ? AND owner_id = ?)
       OR (SELECT COUNT(*) FROM push_subscriptions WHERE owner_id = ?) < ?
    ON CONFLICT(endpoint_hash) DO UPDATE SET
      endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
      expiration_at = excluded.expiration_at, personal = excluded.personal, vynalth = excluded.vynalth,
      updated_at = excluded.updated_at
    WHERE push_subscriptions.owner_id = excluded.owner_id
    RETURNING id, personal, vynalth
  `).bind(randomUUID(), OWNER, hash, subscription.endpoint, subscription.p256dh, subscription.auth,
    subscription.expiration, Number(accounts.includes('personal')), Number(accounts.includes('vynalth')),
    now, now, hash, OWNER, OWNER, MAX_DEVICES).first();
  if (!row) throw new HttpError(409, 'DEVICE_LIMIT', '已达到 20 台通知设备上限，请先关闭其他设备的通知。');
  return json({ ok: true, subscriptionId: row.id, accounts: accountList(row) });
}

function retrySeconds(response, attempts, now) {
  const raw = response?.headers.get('retry-after');
  const numeric = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  // Do not allow a push service to hold an event beyond its lifetime.
  if (Number.isFinite(numeric)) return Math.max(5, Math.min(numeric, 3600));
  const retryDate = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(retryDate)) return Math.max(5, Math.min(Math.ceil((retryDate - now) / 1000), 3600));
  return Math.min(300, 5 * 2 ** Math.min(attempts - 1, 6));
}

async function sendPush(env, subscription, payload, ttl, fetchImpl, attempts = 1, now = Date.now()) {
  let details;
  try {
    details = generateRequestDetails({
      endpoint: normalizeEndpoint(subscription.endpoint),
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }, JSON.stringify(payload), {
      TTL: Math.max(1, Math.min(86400, Math.ceil(ttl))),
      contentEncoding: 'aes128gcm', urgency: 'normal',
      vapidDetails: { subject: APP_ORIGIN, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
    });
  } catch {
    // Key/configuration failures must not erase a device's subscription.
    return { result: 'retry', status: 0, retryAfter: 60 };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(details.headers)) {
      if (key.toLowerCase() !== 'content-length') headers.set(key, String(value));
    }
    const response = await fetchImpl(details.endpoint, {
      method: details.method, headers, body: details.body, redirect: 'manual', signal: controller.signal,
    });
    // Provider bodies can contain capability URLs. Never return or log them.
    await response.body?.cancel();
    if (response.status >= 200 && response.status < 300) return { result: 'sent', status: response.status };
    if (response.status === 404 || response.status === 410) return { result: 'expired', status: response.status };
    if (response.status === 429 || response.status === 401 || response.status === 403 || response.status >= 500) {
      return { result: 'retry', status: response.status, retryAfter: retrySeconds(response, attempts, now) };
    }
    return { result: 'failed', status: response.status };
  } catch { return { result: 'retry', status: 0, retryAfter: retrySeconds(null, attempts, now) }; }
  finally { clearTimeout(timeout); }
}

async function testNotification(env, body, now, fetchImpl) {
  const hash = digest(normalizeEndpoint(body.endpoint));
  const existing = await env.DB.prepare('SELECT id, expiration_at FROM push_subscriptions WHERE owner_id = ? AND endpoint_hash = ?').bind(OWNER, hash).first();
  if (!existing || (existing.expiration_at !== null && existing.expiration_at <= now)) {
    if (existing) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(existing.id).run();
    throw new HttpError(404, 'NOT_SUBSCRIBED', '请先在本设备开启通知。');
  }
  const row = await env.DB.prepare(`UPDATE push_subscriptions SET last_test_at = ?
    WHERE id = ? AND (last_test_at IS NULL OR last_test_at <= ?) RETURNING *`)
    .bind(now, existing.id, now - 15_000).first();
  if (!row) throw new HttpError(429, 'TEST_RATE_LIMIT', '请等待 15 秒后再测试通知。', { 'retry-after': '15' });
  const account = accountList(row)[0];
  const result = await sendPush(env, row, {
    type: 'test', account, title: 'Vyncuslim Mail',
    body: '通知已连接。收到新邮件时，这台设备会提醒你。', url: '/', tag: 'vmail-test',
  }, 60, fetchImpl);
  if (result.result === 'expired') {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
    throw new HttpError(409, 'EXPIRED_SUBSCRIPTION', '设备推送订阅已过期，请重新开启通知。');
  }
  if (result.result !== 'sent') throw new HttpError(503, 'PUSH_UNAVAILABLE', '暂时无法发送测试通知，请稍后重试。');
  return json({ ok: true, accepted: true });
}

function authorizedRecipient(recipients, account) {
  if (!Array.isArray(recipients) || recipients.length > 1000) return false;
  return recipients.some((value) => {
    if (typeof value !== 'string' || value.length > 512 || /[\r\n]/.test(value)) return false;
    const address = (value.trim().match(/^[^<>,;]*<([^<>]+)>$/)?.[1] || value).trim().toLowerCase();
    if (!/^[^\s@<>,;"\\]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)) return false;
    return RECIPIENT_DOMAINS[account].has(address.split('@')[1]);
  });
}

async function snapshotEvent(db, event, now) {
  // D1 batch executes sequentially in one transaction. The snapshot_ready flag
  // also freezes an empty audience: retries never add newly subscribed devices.
  const flag = event.account === 'personal' ? 'personal' : 'vynalth';
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO push_events
      (id, account, email_id, first_seen_at, event_at, expires_at, snapshot_ready)
      VALUES (?, ?, ?, ?, ?, ?, 0)`)
      .bind(event.id, event.account, event.emailId, now, event.eventAt, event.eventAt + DAY),
    db.prepare(`INSERT OR IGNORE INTO push_deliveries(event_id, subscription_id)
      SELECT e.id, s.id FROM push_events e CROSS JOIN push_subscriptions s
      WHERE e.id = ? AND e.snapshot_ready = 0 AND s.owner_id = ? AND s.${flag} = 1
        AND (s.expiration_at IS NULL OR s.expiration_at > ?)`)
      .bind(event.id, OWNER, now),
    db.prepare('UPDATE push_events SET snapshot_ready = 1 WHERE id = ?').bind(event.id),
  ]);
}

async function deliverOne(env, event, row, now, fetchImpl) {
  if (row[event.account] !== 1 || (row.expiration_at !== null && row.expiration_at <= now)) {
    await env.DB.prepare(`UPDATE push_deliveries SET state = 'cancelled', lease_until = NULL
      WHERE event_id = ? AND subscription_id = ?
        AND (state IN ('pending','retry') OR (state = 'sending' AND lease_until <= ?))`)
      .bind(event.id, row.id, now).run();
    return;
  }
  const claimed = await env.DB.prepare(`UPDATE push_deliveries
    SET state = 'sending', lease_until = ?, attempts = attempts + 1
    WHERE event_id = ? AND subscription_id = ? AND attempts < ?
      AND ((state IN ('pending','retry') AND next_attempt_at <= ?) OR (state = 'sending' AND lease_until <= ?))
    RETURNING attempts, lease_until`)
    .bind(now + LEASE_MS, event.id, row.id, MAX_ATTEMPTS, now, now).first();
  if (!claimed) return;
  const encodedId = event.account === 'personal' ? event.emailId : 'vynalth:' + event.emailId;
  const result = await sendPush(env, row, {
    type: 'mail', account: event.account, title: 'Vyncuslim Mail',
    body: event.account === 'personal' ? '你的个人邮箱收到一封新邮件，点按查看。' : '你的企业邮箱收到一封新邮件，点按查看。',
    url: '/?notification=' + encodeURIComponent(encodedId), tag: 'mail-' + event.id.slice(0, 32),
  }, (event.expiresAt - now) / 1000, fetchImpl, claimed.attempts, now);
  if (result.result === 'expired') {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
    return;
  }
  let state = result.result;
  if (state === 'retry' && claimed.attempts >= MAX_ATTEMPTS) state = 'failed';
  await env.DB.prepare(`UPDATE push_deliveries
    SET state = ?, lease_until = NULL, next_attempt_at = ?, last_status = ?, sent_at = ?
    WHERE event_id = ? AND subscription_id = ? AND state = 'sending' AND lease_until = ? AND attempts = ?`)
    .bind(state, now + (result.retryAfter || 0) * 1000, result.status,
      state === 'sent' ? now : null, event.id, row.id, claimed.lease_until, claimed.attempts).run();
}

async function processWebhook(request, env, account, now, fetchImpl) {
  const id = request.headers.get('svix-id');
  const timestamp = request.headers.get('svix-timestamp');
  const signature = request.headers.get('svix-signature');
  if (!id || id.length > 256 || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || signature.length > 4096) {
    throw new HttpError(400, 'INVALID_SIGNATURE', 'Webhook 签名无效。');
  }
  const rawBody = await readText(request, 262_144);
  let body;
  try {
    new Webhook(webhookSecret(env, account)).verify(rawBody, {
      'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature,
    });
    // Svix 2 verifies signatures without returning parsed JSON.
    body = JSON.parse(rawBody);
  } catch { throw new HttpError(400, 'INVALID_SIGNATURE', 'Webhook 签名无效。'); }
  if (body?.type !== 'email.received') return json({ ok: true, ignored: true });
  const data = body.data;
  if (!data || typeof data.email_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.email_id)) {
    throw new HttpError(400, 'INVALID_EVENT', '邮件事件格式无效。');
  }
  if (!authorizedRecipient(data.to, account)) return json({ ok: true, ignored: true });
  const eventAt = Date.parse(data.created_at || body.created_at);
  if (!Number.isFinite(eventAt) || eventAt > now + 300_000) {
    throw new HttpError(400, 'INVALID_EVENT', '邮件事件时间无效。');
  }
  if (eventAt + DAY <= now) return json({ ok: true, ignored: true });
  const event = { id: digest(account + '\0' + data.email_id), account, emailId: data.email_id, eventAt, expiresAt: eventAt + DAY };
  await snapshotEvent(env.DB, event, now);
  const persisted = await env.DB.prepare('SELECT expires_at FROM push_events WHERE id = ?').bind(event.id).first();
  event.expiresAt = persisted.expires_at;
  if (event.expiresAt <= now) return json({ ok: true, ignored: true });
  // Expired final leases must become terminal instead of retrying forever.
  await env.DB.prepare(`UPDATE push_deliveries SET state = 'failed', lease_until = NULL
    WHERE event_id = ? AND attempts >= ? AND state IN ('pending','retry','sending')
      AND (lease_until IS NULL OR lease_until <= ?)`)
    .bind(event.id, MAX_ATTEMPTS, now).run();
  const { results } = await env.DB.prepare(`SELECT s.* FROM push_deliveries d
    JOIN push_subscriptions s ON s.id = d.subscription_id
    WHERE d.event_id = ? AND d.state IN ('pending','retry','sending')`)
    .bind(event.id).all();
  for (let offset = 0; offset < results.length; offset += 5) {
    // Never acknowledge before sends and persistence finish. Successful devices
    // are excluded on retry, while active leases keep the webhook retryable.
    await Promise.all(results.slice(offset, offset + 5).map((row) => deliverOne(env, event, row, now, fetchImpl)));
  }
  const unfinished = await env.DB.prepare(`SELECT COUNT(*) AS pending,
      MIN(CASE WHEN state = 'sending' THEN lease_until ELSE next_attempt_at END) AS retry_at
    FROM push_deliveries WHERE event_id = ? AND state IN ('pending','retry','sending')`).bind(event.id).first();
  if (unfinished.pending > 0) {
    const retryAfter = Math.max(5, Math.min(3600, Math.ceil((unfinished.retry_at - now) / 1000)));
    throw new HttpError(503, 'DELIVERY_RETRY', '通知投递暂未完成，请重试。', { 'retry-after': String(retryAfter) });
  }
  await env.DB.prepare(`DELETE FROM push_events WHERE id IN
    (SELECT id FROM push_events WHERE first_seen_at < ? ORDER BY first_seen_at LIMIT 100)`)
    .bind(now - 7 * DAY).run();
  return json({ ok: true });
}

// Dependency injection is solely a local-test boundary; no request or binding can
// replace the authenticated origin, outbound implementation, or clock.
export function createWorker({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  return {
    async fetch(request, env) {
      try {
        const path = new URL(request.url).pathname;
        if (path === '/health' && request.method === 'GET') {
          try { await requireReady(env); return json({ ok: true, ready: true }); }
          catch { return json({ ok: false, ready: false }, 503); }
        }
        if (path === '/api/notifications/config' && request.method === 'GET') {
          await requireReady(env);
          return json({ enabled: true, publicKey: env.VAPID_PUBLIC_KEY, accounts: ACCOUNTS });
        }
        const hook = path.match(/^\/webhooks\/resend\/(personal|vynalth)$/);
        if (hook && request.method === 'POST') {
          await requireReady(env);
          return await processWebhook(request, env, hook[1], now(), fetchImpl);
        }
        const privateRoute = (path === '/api/notifications/subscription' && ['POST', 'DELETE'].includes(request.method))
          || (['/api/notifications/status', '/api/notifications/test'].includes(path) && request.method === 'POST');
        if (!privateRoute) return json({ error: '找不到此接口。', code: 'NOT_FOUND' }, 404);
        // Reject anonymous/cross-site requests before touching subscription state.
        await authenticate(request, fetchImpl);
        await requireReady(env);
        const body = await readJson(request);
        const current = now();
        if (path === '/api/notifications/subscription' && request.method === 'POST') {
          return await saveSubscription(env.DB, body, current);
        }
        if (path === '/api/notifications/test') return await testNotification(env, body, current, fetchImpl);
        const hash = digest(normalizeEndpoint(body.endpoint));
        if (request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM push_subscriptions WHERE owner_id = ? AND endpoint_hash = ?').bind(OWNER, hash).run();
          return json({ ok: true });
        }
        const row = await env.DB.prepare(`SELECT personal, vynalth FROM push_subscriptions
          WHERE owner_id = ? AND endpoint_hash = ? AND (expiration_at IS NULL OR expiration_at > ?)`)
          .bind(OWNER, hash, current).first();
        return json({ subscribed: !!row, accounts: accountList(row) });
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status, error.headers);
        // D1 outages and unexpected faults must remain retryable and private.
        return json({ error: '通知服务暂时不可用，请稍后重试。', code: 'SERVICE_UNAVAILABLE' }, 503);
      }
    },
  };
}

export default createWorker();
