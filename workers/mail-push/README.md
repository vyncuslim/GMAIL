# Vyncuslim Mail push service

Independent Cloudflare Worker and D1 service for the installed mailbox PWA. Resend's signed `email.received` webhook triggers an encrypted Web Push message. No mail body, sender or subject is included in the notification or stored in this service.

## Build and verify

Use Node 24 or newer from this directory:

```sh
npm ci
npm test
```

`npm run build` produces `dist/worker.mjs`, an ES-module Worker. The test suite runs this exact bundle inside Miniflare/workerd with a real local D1 database, official Svix signatures, real Web Push encryption, and an intercepted outbound service. It decrypts captured messages locally to validate the payload. No test sends a live push, mail, webhook or authentication request.

The installed Miniflare runtime uses compatibility date `2026-07-30`; the deployment target is `2026-11-25` with `nodejs_compat`. No Wrangler configuration or deployment command is included. `web-push` generates the encrypted request; Worker `fetch` sends it. The build disables only its unused Node proxy transport and adapts CommonJS Node builtin imports. Maintained Web Push encryption and VAPID signing remain unchanged.

## Deployment contract

1. Create a dedicated D1 database and apply `schema.sql`. The migration is idempotent.
2. Upload `dist/worker.mjs` through the Cloudflare Workers API as the `main_module`, with compatibility date `2026-11-25` and flag `nodejs_compat`.
3. Configure the bindings below. Generate one persistent P-256 VAPID key pair with Web Crypto or the maintained `web-push` library in a secure administrative environment. Keep the private key out of source, logs and browser code. Rotating the pair requires devices to subscribe again. Production keys were generated and stored directly inside the administrative Cloudflare execution environment. Preserve secret bindings on future code uploads with `keep_bindings: ["secret_text"]`; do not overwrite or regenerate the VAPID pair during normal deployment.
4. Route only `mail.vyncuslim.com/api/notifications/*` to this Worker. The existing mailbox continues to serve `/api/auth/status` and all other app routes.
5. In each Resend account, create one `email.received` webhook at its corresponding Worker URL. Store each returned signing secret in its account's distinct Worker secret binding. Use the Worker's `workers.dev` hostname for these webhook URLs; no additional mail-domain DNS/MX change is required for this service.
6. Check `/health` and `/api/notifications/config`, then verify anonymous, foreign-Origin, and fake-session requests cannot subscribe. A real device registers only after the owner signs in and chooses to enable notifications in the app.

| Binding | Type | Value / purpose |
| --- | --- | --- |
| `DB` | D1 binding | Dedicated notification database (`database_id` in Cloudflare API upload metadata) |
| `APP_ORIGIN` | Plain text | Exactly `https://mail.vyncuslim.com` |
| `VAPID_SUBJECT` | Plain text | Exactly `https://mail.vyncuslim.com` |
| `VAPID_PUBLIC_KEY` | Text or secret binding | Persistent P-256 VAPID public key, base64url; production uses a secret binding for persistence, but the configuration endpoint intentionally returns this public key |
| `VAPID_PRIVATE_KEY` | Secret | Matching private key, base64url |
| `RESEND_WEBHOOK_SECRET_PERSONAL` | Secret | Signing secret for the personal Resend account |
| `RESEND_WEBHOOK_SECRET_VYNALTH` | Secret | Signing secret for the company Resend account |

Missing schema, incomplete bindings, or a mismatched VAPID key pair cause a clear 503 response. Health exposes only `ok` and `ready`, never device counts, endpoints or secrets.

## Browser API

All responses use `Cache-Control: no-store`. Only configuration is public. Other browser operations require exact `Origin: https://mail.vyncuslim.com` and a current `vmail_session` cookie. The Worker sends only that cookie and the browser User-Agent to the fixed mailbox `/api/auth/status` URL with no cache, no followed redirects and a four-second deadline. Only HTTP 200 with JSON `authenticated: true` authorizes the operation. Invalid sessions return 401; authentication service failures return 503.

| Method / path | JSON request | Success response |
| --- | --- | --- |
| `GET /api/notifications/config` | None | `{enabled:true,publicKey,accounts:["personal","vynalth"]}` |
| `POST /api/notifications/subscription` | `{subscription:{endpoint,expirationTime,keys:{p256dh,auth}},accounts:[...]}` | `{ok:true,subscriptionId,accounts}` |
| `POST /api/notifications/status` | `{endpoint}` | `{subscribed,accounts}` |
| `DELETE /api/notifications/subscription` | `{endpoint}` | `{ok:true}` |
| `POST /api/notifications/test` | `{endpoint}` | `{ok:true,accepted:true}` |

Test notifications require a stored device and allow one attempt per device per 15 seconds. `accepted` means the push service accepted the encrypted message; operating-system settings and network availability still determine when a device displays it.

Subscriptions are limited to 20 devices for this single-owner mailbox. Endpoints must be HTTPS URLs belonging to supported FCM, Mozilla, Apple or Windows push services. Encryption keys must be canonical base64url with valid P-256 public keys. Raw endpoints are capability URLs: they remain private in D1, are indexed by SHA-256, and are never returned or logged. Unsubscribe deletes the endpoint and its pending deliveries. Provider 404/410 responses also delete expired endpoints; provider 401/403 responses retain them for recovery.

## Webhooks and delivery behavior

| Path | Secret | Accepted recipient domains |
| --- | --- | --- |
| `/webhooks/resend/personal` | Personal signing secret | `vyncuslim.com`, `mail.vyncuslim.com` |
| `/webhooks/resend/vynalth` | Company signing secret | `vynalthai.com`, `mail.vynalthai.com`, `sleepsomno.com`, `mail.sleepsomno.com`, `www.sleepsomno.com`, `vitashield.sleepsomno.com` |

The official Svix verifier validates the raw request body, timestamp window and signature rotation candidates. Each account has its own signing key. Only `email.received` with an accepted `to` address is processed. `received_for` alone does not establish authorization. Other events and emails older than 24 hours are acknowledged without pushing.

The payload includes `type`, `account`, a generic Chinese notification body, and a same-origin relative mail link. Personal email IDs remain unchanged; company IDs use the app's `vynalth:` prefix. Notification tags are hashes, not addresses or subjects. The service worker must always display a visible notification and must validate notification links before opening them.

D1 records one event per account/email ID and one delivery per subscribed device. A sequential transactional batch creates the event, snapshots its audience, and freezes that snapshot, including an empty audience. Replaying a webhook cannot notify devices registered later. Per-device leases prevent concurrent handlers from sending the same delivery at the same time. Successfully accepted devices are excluded from retries.

The webhook waits for encrypted sends and persistence before responding. Temporary network errors, 429, 5xx and authentication errors retain retry state and return 503 so Resend can retry. The response's `Retry-After` respects both numeric and HTTP-date provider values and active leases, bounded to one hour. Delivery concurrency is five with a four-second outbound deadline, at most 12 attempts per device/event and a 24-hour event lifetime. Active leases remain retryable; interruption recovery can reclaim them after 30 seconds. Opting out cancels queued deliveries. Final nonretryable provider errors mark that event/device delivery failed while retaining the subscription.

Resend supplies the retry scheduler. Persistent provider failures after its retry window can still leave an undelivered notification; this is not an independent queue/cron system. A crash after provider acceptance but before D1 success persistence can cause one repeat attempt; the stable notification tag lets the device replace that notification. Push acceptance cannot guarantee device delivery, especially when notifications are disabled or the operating system restricts the app.

Event/delivery records older than seven days are cleaned up in bounded batches when successful webhooks are processed. No email content is stored. Subscription records persist until the owner removes them, a reported expiration is reached, or the provider marks them expired.

## Primary references

- [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend received event](https://resend.com/docs/webhooks/emails/received)
- [Svix webhook verification library](https://github.com/svix/svix-webhooks)
- [Maintained web-push library](https://github.com/web-push-libs/web-push)
- [Cloudflare D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Node crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [Microsoft Edge Push](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push)
