import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { Webhook } from 'svix';
import { generateVAPIDKeys } from 'web-push';
import ece from 'http_ece';
import { APP_ORIGIN, createWorker } from '../src/worker.mjs';

// All credentials are ephemeral local fixtures. Outbound networking is fully
// intercepted; these tests never contact Resend, the mailbox, or a push service.
const vapid = generateVAPIDKeys();
const secrets = {
  personal: 'whsec_' + randomBytes(32).toString('base64'),
  vynalth: 'whsec_' + randomBytes(32).toString('base64'),
};
const bindings = {
  APP_ORIGIN, VAPID_SUBJECT: APP_ORIGIN,
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  RESEND_WEBHOOK_SECRET_PERSONAL: secrets.personal,
  RESEND_WEBHOOK_SECRET_VYNALTH: secrets.vynalth,
};
const cookie = 'vmail_session=vyncuslim-mail.' + 'a'.repeat(64);
let mf;
let db;
let pushes;
let authRequests;
let authResponder;
let pushResponder;
let deviceCounter = 0;

function device() {
  const key = createECDH('prime256v1');
  key.generateKeys();
  const auth = randomBytes(16);
  return {
    privateKey: key, authSecret: auth,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/local-test-' + ++deviceCounter,
      expirationTime: null,
      keys: { p256dh: key.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    },
  };
}

function api(path, body, { method = 'POST', headers = {} } = {}) {
  return mf.dispatchFetch(APP_ORIGIN + '/api/notifications/' + path, {
    method,
    headers: { origin: APP_ORIGIN, cookie, 'content-type': 'application/json', 'user-agent': 'Local-Test-UA', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function subscribe(dev, accounts = ['personal', 'vynalth']) {
  const response = await api('subscription', { subscription: dev.subscription, accounts });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function event(account = 'personal', options = {}) {
  const created = new Date().toISOString();
  return {
    type: 'email.received', created_at: created,
    data: {
      email_id: randomUUID(), created_at: created,
      from: 'private-sender@example.com',
      to: [account === 'personal' ? 'owner@vyncuslim.com' : 'owner@vynalthai.com'],
      subject: 'Private subject that must never reach notifications',
      ...options,
    },
  };
}

function webhook(body, account = 'personal', options = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const id = options.id || 'msg_' + randomUUID();
  const date = options.date || new Date();
  const signature = new Webhook(options.secret || secrets[account]).sign(id, date, payload);
  return mf.dispatchFetch(APP_ORIGIN + '/webhooks/resend/' + account, {
    method: 'POST', body: options.rawBody || payload,
    headers: {
      'content-type': 'application/json', 'svix-id': id,
      'svix-timestamp': String(Math.floor(date.getTime() / 1000)),
      'svix-signature': options.signature || signature,
    },
  });
}

function decrypt(capture, dev) {
  return JSON.parse(ece.decrypt(capture.body, {
    version: 'aes128gcm', privateKey: dev.privateKey, authSecret: dev.authSecret,
  }).toString('utf8'));
}

before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: new URL('../dist/worker.mjs', import.meta.url).pathname,
    // The installed workerd build is dated July; production uses 2026-11-25.
    compatibilityDate: '2026-07-30', compatibilityFlags: ['nodejs_compat'],
    bindings, d1Databases: ['DB'], log: new Log(LogLevel.ERROR),
    outboundService: async (request) => {
      if (request.url === APP_ORIGIN + '/api/auth/status') {
        authRequests.push({ url: request.url, headers: new Headers(request.headers) });
        return authResponder(request);
      }
      if (request.url.startsWith('https://fcm.googleapis.com/fcm/send/local-test-')) {
        const capture = { url: request.url, headers: new Headers(request.headers), body: Buffer.from(await request.arrayBuffer()) };
        pushes.push(capture);
        return pushResponder(capture);
      }
      // The callback is the only outbound service, so no unmocked traffic can escape.
      return new Response(null, { status: 599 });
    },
  });
  db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.batch(schema.split(';').map((sql) => sql.trim()).filter(Boolean).map((sql) => db.prepare(sql)));
});

beforeEach(async () => {
  pushes = [];
  authRequests = [];
  authResponder = () => Response.json({ authenticated: true });
  pushResponder = () => new Response(null, { status: 201 });
  await db.batch([
    db.prepare('DELETE FROM push_deliveries'),
    db.prepare('DELETE FROM push_events'),
    db.prepare('DELETE FROM push_subscriptions'),
  ]);
});

after(async () => { await mf?.dispose(); });

test('built Worker reports readiness without exposing credentials or device state', async () => {
  const config = await mf.dispatchFetch(APP_ORIGIN + '/api/notifications/config');
  assert.equal(config.status, 200);
  assert.deepEqual(await config.json(), { enabled: true, publicKey: vapid.publicKey, accounts: ['personal', 'vynalth'] });
  assert.deepEqual(await (await mf.dispatchFetch(APP_ORIGIN + '/health')).json(), { ok: true, ready: true });
  assert.equal(config.headers.get('cache-control'), 'no-store');
});

test('missing schema, missing secret, invalid key pair and arbitrary auth origin fail readiness', async () => {
  const local = createWorker({ fetchImpl: () => { throw new Error('Unexpected network'); } });
  for (const changed of [
    { VAPID_PRIVATE_KEY: undefined }, { VAPID_PUBLIC_KEY: generateVAPIDKeys().publicKey },
    { RESEND_WEBHOOK_SECRET_VYNALTH: '' }, { APP_ORIGIN: 'https://evil.example' },
    { DB: { prepare() { throw new Error('no schema'); } } },
  ]) {
    const response = await local.fetch(new Request(APP_ORIGIN + '/api/notifications/config'), { ...bindings, DB: db, ...changed });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SERVICE_NOT_READY');
  }
});

test('subscription/status/delete require exact Origin and current login', async () => {
  const dev = device();
  const body = { subscription: dev.subscription, accounts: ['personal'] };
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }]) {
    assert.equal((await api('subscription', body, { headers })).status, 403);
  }
  for (const value of ['', 'vmail_session=wrong', cookie + '; ' + cookie]) {
    assert.equal((await api('subscription', body, { headers: { cookie: value } })).status, 401);
  }
  assert.equal(authRequests.length, 0);
  authResponder = () => Response.json({ authenticated: false });
  assert.equal((await api('subscription', body)).status, 401);
  for (const status of [302, 401, 403, 500]) {
    authResponder = () => new Response(null, { status });
    const response = await api('subscription', body);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'AUTH_UNAVAILABLE');
  }
  authResponder = () => new Response('<html>upstream error</html>');
  assert.equal((await api('subscription', body)).status, 503);
  authResponder = () => Response.json({ authenticated: true });
  await subscribe(dev);
  assert.equal((await api('status', { endpoint: dev.subscription.endpoint }, { headers: { cookie: '' } })).status, 401);
  assert.equal((await api('subscription', { endpoint: dev.subscription.endpoint }, { method: 'DELETE', headers: { origin: '' } })).status, 403);
});

test('auth callback forwards only session cookie and browser User-Agent to fixed URL', async () => {
  const dev = device();
  await api('subscription', { subscription: dev.subscription, accounts: ['personal'] }, {
    headers: { cookie: 'analytics=private; ' + cookie + '; another=secret', 'user-agent': 'FixtureBrowser/1' },
  });
  assert.equal(authRequests.length, 1);
  assert.equal(authRequests[0].url, APP_ORIGIN + '/api/auth/status');
  assert.equal(authRequests[0].headers.get('cookie'), cookie);
  assert.equal(authRequests[0].headers.get('user-agent'), 'FixtureBrowser/1');
  assert.equal(authRequests[0].headers.get('accept'), 'application/json');
});

test('SSRF endpoints and malformed encryption keys are rejected without outgoing pushes', async () => {
  const dev = device();
  for (const endpoint of [
    'https://127.0.0.1/private', 'http://fcm.googleapis.com/path',
    'https://fcm.googleapis.com.evil.example/path', 'https://evilpush.apple.com/path',
    'https://evil.example/path', 'https://fcm.googleapis.com:8443/path',
    'https://user:password@fcm.googleapis.com/path', 'https://fcm.googleapis.com/path#fragment',
    'https://fcm.googleapis.com/path#', 'https://fcm.googleapis.com/',
    'https://localhost/path', 'https://[::1]/path', 'https://fcm.googleapis.com/path\n',
  ]) {
    const response = await api('subscription', { subscription: { ...dev.subscription, endpoint }, accounts: ['personal'] });
    assert.equal(response.status, 400);
  }
  for (const keys of [
    { ...dev.subscription.keys, auth: randomBytes(15).toString('base64url') },
    { ...dev.subscription.keys, p256dh: Buffer.alloc(65, 4).toString('base64url') },
    { ...dev.subscription.keys, p256dh: dev.subscription.keys.p256dh + '=' },
  ]) {
    assert.equal((await api('subscription', { subscription: { ...dev.subscription, keys }, accounts: ['personal'] })).status, 400);
  }
  assert.equal(pushes.length, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n, 0);
});

test('device preferences update idempotently, subscription response hides capability endpoint, delete persists', async () => {
  const dev = device();
  const initial = await subscribe(dev, ['personal']);
  const updated = await subscribe(dev, ['vynalth']);
  assert.equal(initial.subscriptionId, updated.subscriptionId);
  assert.deepEqual(updated.accounts, ['vynalth']);
  assert.equal(JSON.stringify(updated).includes(dev.subscription.endpoint), false);
  assert.deepEqual(await (await api('status', { endpoint: dev.subscription.endpoint })).json(), { subscribed: true, accounts: ['vynalth'] });
  assert.equal((await api('subscription', { endpoint: dev.subscription.endpoint }, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await api('status', { endpoint: dev.subscription.endpoint })).json(), { subscribed: false, accounts: [] });
});

test('twenty-device limit is persistent and existing preferences can still be updated', async () => {
  const devices = Array.from({ length: 21 }, () => device());
  for (const dev of devices.slice(0, 20)) await subscribe(dev);
  assert.equal((await api('subscription', { subscription: devices[20].subscription, accounts: ['personal'] })).status, 409);
  await subscribe(devices[0], ['vynalth']);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n, 20);
});

test('official Web Push request runs in workerd, decrypts to private generic payload, and deduplicates mail IDs', async () => {
  const dev = device();
  await subscribe(dev);
  const body = event();
  const response = await webhook(body);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].headers.get('content-encoding'), 'aes128gcm');
  assert.match(pushes[0].headers.get('authorization'), /^vapid t=.+, k=.+/);
  assert.ok(pushes[0].body.byteLength > 100);
  const payload = decrypt(pushes[0], dev);
  assert.deepEqual(Object.keys(payload).sort(), ['account', 'body', 'tag', 'title', 'type', 'url']);
  assert.equal(payload.type, 'mail');
  assert.equal(payload.account, 'personal');
  assert.equal(payload.title, 'Vyncuslim Mail');
  assert.equal(payload.body, '你的个人邮箱收到一封新邮件，点按查看。');
  assert.equal(payload.url, '/?notification=' + body.data.email_id);
  assert.match(payload.tag, /^mail-[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(payload).includes('Private subject'), false);
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM push_deliveries WHERE state = 'sent'").first()).n, 1);
});

test('company notifications use separate account secret and encoded company deep link', async () => {
  const dev = device();
  await subscribe(dev, ['vynalth']);
  const body = event('vynalth', { to: ['Legacy <owner@sleepsomno.com>'] });
  assert.equal((await webhook(body, 'vynalth', { secret: secrets.personal })).status, 400);
  assert.equal(pushes.length, 0);
  assert.equal((await webhook(body, 'vynalth')).status, 200);
  const payload = decrypt(pushes[0], dev);
  assert.equal(payload.account, 'vynalth');
  assert.equal(payload.url, '/?notification=' + encodeURIComponent('vynalth:' + body.data.email_id));
  assert.equal(payload.body, '你的企业邮箱收到一封新邮件，点按查看。');
});

test('tampering, expired/future Svix signatures fail, valid signature among rotation candidates succeeds', async () => {
  const dev = device();
  await subscribe(dev);
  const body = event();
  assert.equal((await webhook(body, 'personal', { rawBody: JSON.stringify({ ...body, type: 'tampered' }) })).status, 400);
  assert.equal((await webhook(body, 'personal', { date: new Date(Date.now() - 301_000) })).status, 400);
  assert.equal((await webhook(body, 'personal', { date: new Date(Date.now() + 301_000) })).status, 400);
  const id = 'msg_' + randomUUID();
  const date = new Date();
  const good = new Webhook(secrets.personal).sign(id, date, JSON.stringify(body));
  const wrong = new Webhook(secrets.vynalth).sign(id, date, JSON.stringify(body));
  assert.equal((await webhook(body, 'personal', { id, date, signature: wrong + ' ' + good })).status, 200);
  assert.equal(pushes.length, 1);
});

test('wrong account recipients, received_for alone, old events and unrelated events are safely ignored', async () => {
  await subscribe(device());
  for (const body of [
    event('personal', { to: ['owner@vynalthai.com'] }),
    event('personal', { to: ['owner@vyncuslim.com.evil.example'] }),
    event('personal', { to: ['owner@other.example'], received_for: ['owner@vyncuslim.com'] }),
    event('personal', { created_at: new Date(Date.now() - 86_400_001).toISOString() }),
    { ...event(), type: 'email.sent' },
  ]) {
    const response = await webhook(body);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ignored, true);
  }
  assert.equal(pushes.length, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_events').first()).n, 0);
});

test('temporary failures retain devices and retry only unfinished deliveries', async () => {
  const a = device();
  const b = device();
  await subscribe(a);
  await subscribe(b);
  pushResponder = (capture) => new Response(null, { status: capture.url === b.subscription.endpoint ? 503 : 201 });
  const body = event();
  assert.equal((await webhook(body)).status, 503);
  assert.equal(pushes.length, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n, 2);
  await db.prepare("UPDATE push_deliveries SET next_attempt_at = 0 WHERE state = 'retry'").run();
  pushResponder = () => new Response(null, { status: 201 });
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 3);
  assert.equal(pushes[2].url, b.subscription.endpoint);
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 3);
});

test('429 Retry-After is persisted and exposed to webhook retries without early re-sending', async () => {
  await subscribe(device());
  pushResponder = () => new Response(null, { status: 429, headers: { 'retry-after': '3600' } });
  const body = event();
  const first = await webhook(body);
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('retry-after'), '3600');
  const second = await webhook(body);
  assert.equal(second.status, 503);
  assert.ok(Number(second.headers.get('retry-after')) > 3500);
  assert.equal(pushes.length, 1);
  await db.prepare("UPDATE push_deliveries SET next_attempt_at = 0 WHERE state = 'retry'").run();
  pushResponder = () => new Response(null, { status: 201 });
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 2);
  pushResponder = () => new Response(null, {
    status: 429, headers: { 'retry-after': new Date(Date.now() + 3_600_000).toUTCString() },
  });
  const datedRetry = await webhook(event());
  assert.equal(datedRetry.status, 503);
  assert.ok(Number(datedRetry.headers.get('retry-after')) > 3500);
});

test('404/410 remove expired endpoints; 401/403 preserve endpoints for recovery', async () => {
  for (const status of [404, 410, 401, 403]) {
    await db.prepare('DELETE FROM push_subscriptions').run();
    const dev = device();
    await subscribe(dev);
    pushResponder = () => new Response(null, { status });
    const response = await webhook(event());
    assert.equal(response.status, status < 404 ? 503 : 200);
    const count = (await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).n;
    assert.equal(count, status < 404 ? 1 : 0);
  }
});

test('active leases stay retryable and expired leases can be reclaimed after interruption', async () => {
  await subscribe(device());
  pushResponder = () => new Response(null, { status: 503 });
  const body = event();
  assert.equal((await webhook(body)).status, 503);
  await db.prepare("UPDATE push_deliveries SET state = 'sending', lease_until = ?").bind(Date.now() + 30_000).run();
  pushResponder = () => new Response(null, { status: 201 });
  assert.equal((await webhook(body)).status, 503);
  assert.equal(pushes.length, 1);
  await db.prepare('UPDATE push_deliveries SET lease_until = 0').run();
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 2);
});

test('event audience is frozen, including when first delivery had no subscribers', async () => {
  const noAudience = event();
  assert.equal((await webhook(noAudience)).status, 200);
  const a = device();
  await subscribe(a);
  assert.equal((await webhook(noAudience)).status, 200);
  assert.equal(pushes.length, 0);
  const existingAudience = event();
  assert.equal((await webhook(existingAudience)).status, 200);
  assert.equal(pushes.length, 1);
  const b = device();
  await subscribe(b);
  assert.equal((await webhook(existingAudience)).status, 200);
  assert.equal(pushes.length, 1);
  assert.equal((await webhook(event())).status, 200);
  assert.equal(pushes.length, 3);
});

test('opting out while a delivery is queued cancels subsequent retries', async () => {
  const dev = device();
  await subscribe(dev);
  pushResponder = () => new Response(null, { status: 503 });
  const body = event();
  assert.equal((await webhook(body)).status, 503);
  await subscribe(dev, ['vynalth']);
  assert.equal((await webhook(body)).status, 200);
  assert.equal(pushes.length, 1);
  assert.equal((await db.prepare('SELECT state FROM push_deliveries').first()).state, 'cancelled');
});

test('test pushes require saved device, use actual encryption, and enforce persistent 15-second limit', async () => {
  const dev = device();
  assert.equal((await api('test', { endpoint: dev.subscription.endpoint })).status, 404);
  await subscribe(dev, ['vynalth']);
  const response = await api('test', { endpoint: dev.subscription.endpoint });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, accepted: true });
  const payload = decrypt(pushes[0], dev);
  assert.equal(payload.type, 'test');
  assert.equal(payload.account, 'vynalth');
  assert.equal(payload.url, '/');
  assert.equal((await api('test', { endpoint: dev.subscription.endpoint })).status, 429);
  assert.equal(pushes.length, 1);
  await db.prepare('UPDATE push_subscriptions SET last_test_at = ?').bind(Date.now() - 16_000).run();
  assert.equal((await api('test', { endpoint: dev.subscription.endpoint })).status, 200);
  assert.equal(pushes.length, 2);
});

test('oversized bodies are rejected before JSON parsing or signature work', async () => {
  assert.equal((await api('status', { endpoint: 'x'.repeat(9000) })).status, 413);
  const body = event('personal', { subject: 'x'.repeat(270000) });
  assert.equal((await webhook(body)).status, 413);
  assert.equal(pushes.length, 0);
});
