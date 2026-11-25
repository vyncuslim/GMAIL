# Vyncuslim Mail

Private Webmail for Vercel and two independent Resend accounts.

- Website: `mail.vyncuslim.com`
- Personal domains: `vyncuslim.com`, `mail.vyncuslim.com`
- Vynalth AI domains: `vynalthai.com`, `mail.vynalthai.com`

## Production environment variables

Keep existing `RESEND_API_KEY`, `MAIL_APP_PASSWORD`, and `SESSION_SECRET`. To enable corporate mail, set these additional server-only variables in the Vercel project:

```
RESEND_VYNALTH_API_KEY=<enterprise Resend key with read and send access>
VYNALTH_MAILBOX_ADDRESSES=*@vynalthai.com,*@mail.vynalthai.com
```

The corporate allowlist is explicit and defaults to disabled. Exact addresses are also supported, separated by commas. Wildcards apply to exact domains only. Do not add any NEXT_PUBLIC_ prefix or commit credentials. Vynalth AI mail is only for the authorized private mailbox administrator; enabling both wildcards authorizes access to all mail on the two corporate domains for the authenticated site owner. Keep the existing private login restricted to that owner.

The server selects the provider from the sender for outbound messages and uses account-scoped IDs for inbound/sent detail, replies and attachments. Personal IDs remain unchanged. Each account lists the latest 100 received and 100 sent messages; failure or missing configuration on one account is reported without preventing the other account from loading. Mail history remains with Resend.

## DNS

Both company domains must pass Resend sending and receiving verification. In the `vynalthai.com` zone, the company subdomain MX must use the exact receiving host and priority shown in Resend. Do not overwrite existing personal DNS or web hosting records. The web app reads mail through Resend's receiving API. Background notifications additionally use the two signed `email.received` webhooks described below; they do not change MX or move mail storage.

After setting server environment variables, redeploy and test sending and receiving with each verified domain. Never expose or reuse the personal key for company mail.

## Legacy SleepSomno migration

Outgoing From, To, Cc, Bcc and Reply-To fields map exact `sleepsomno.com` addresses to `vynalthai.com` and exact `mail.sleepsomno.com` addresses to `mail.vynalthai.com`, preserving the local part. Other domains are untouched. This applies only to this webmail app and does not configure old-domain MX, inbound forwarding, third-party SMTP or historical mailbox migration. Configure the legacy domain's actual mail provider separately, retain legacy MX until the new routing is tested, and update any external application SMTP sender settings.

Legacy inbound mail is supported once Resend actually receives it: original recipients are preserved while authorized matching Vynalth addresses are used for inbox filters, reply identity, detail access and attachments. The exact legacy root, www and vitashield addresses map to the new root domain; the old mail subdomain maps to the new mail subdomain. This is an application mailbox alias, not a physical SMTP forward. All legacy receiving domains must be separately onboarded at the provider or use an external forwarding service. No historical Lark mail is imported.

## Logos, photos and signatures

The mailbox shows the Vynalth AI logo for the two corporate domains (and their legacy aliases), and a privately configured photo for the two personal domains. Set `MAIL_PROFILE_PHOTO_URL` as a server-only Vercel environment variable to an HTTPS image URL. The server returns it only in authenticated, non-cacheable mailbox responses and uses that same configuration when composing an outgoing signature. Never add a `NEXT_PUBLIC_` prefix or commit the personal photo URL or bytes. Without configuration, personal addresses keep letter avatars and text-only signatures. Unknown addresses keep letter avatars. This is a display preference, not sender authentication, and there are no third-party avatar lookups for unknown incoming addresses.

New messages and replies offer an **Include logo / photo signature** checkbox with a preview. The preference is saved in each draft. When enabled, the server uses the authorized sender to create both HTML and plain-text signatures, places the new signature before quoted plain-text replies, and adds the brand display name only when the sender has none. Disabling the signature preserves the original sending content. No email is sent when selecting an identity or previewing a signature.

These images affect this webmail and the message body. Gmail and other recipients control their inbox avatar display separately. BIMI requires the receiving provider's authentication and certificate requirements; this change does not create a BIMI record or claim external verification.

Asset provenance: `public/brand/vynalth-logo.svg` is the existing symbol from `vyncuslim/SomnoAI-Digital-Sleep-Lab`, commit `4c4c914df795d5c3d1e7d11ce88c86430e5d62ce`, `public/media/vynalth-mark.svg`. Its PNG is a format conversion with identical artwork. Personal photographs are not stored in this repository. External images remain subject to the receiving email client's image loading and format support.

## Installable app and background notifications

Open the mailbox, sign in, and choose **安装与通知**. Install the app using the offered browser action. On iPhone and iPad (iOS/iPadOS 16.4 or later), use Safari's Share → Add to Home Screen, then open that installed app before enabling notifications. Permission is requested only when the owner presses **开启此设备通知**; each browser or installed app needs its own permission and subscription.

The browser service worker receives standard encrypted Web Push even when no mailbox tab is open, subject to browser and operating-system support, notification permissions, connectivity, power management and Focus settings. Closing a tab is supported; delivery while the entire browser is force-quit is not guaranteed. No web app can override these system controls. A successful test response means the push service accepted the request, not that the device displayed it.

Notifications intentionally show a generic new-mail message. Sender, recipient, subject and body are not sent to the lock-screen notification. Tapping a notification opens its account-scoped message, preserving that destination through password login when necessary. The service worker caches only the public offline page and app icons; it does not store mailbox HTML, API responses, attachments, credentials or email bodies. Offline mode provides a reconnect screen, not an offline copy of private mail.

### Push backend

The separately deployed Cloudflare Worker in `workers/mail-push` uses a dedicated D1 database. The exact route `mail.vyncuslim.com/api/notifications/*` serves authenticated device registration, status, removal and explicit test requests. It verifies the existing private session through the fixed `/api/auth/status` endpoint and requires the mailbox origin on browser mutation requests. No new Vercel secret is needed.

Each Resend account has its own `email.received` webhook and signing secret. The Worker verifies the raw request signature, filters supported receiving domains, freezes the eligible devices when it first records an event, and tracks delivery per device. Retries resume unfinished deliveries without intentionally resending successful ones. Expired subscriptions are removed. Like other network notification systems, a crash between push-provider acceptance and the database update can still cause a duplicate; a stable notification tag replaces that message's existing alert where supported.

Keep the VAPID private key and both webhook signing secrets exclusively in Cloudflare secret bindings. Keep the VAPID pair stable across deployments; rotating the key requires devices to subscribe again. D1 stores push subscription endpoints and encryption keys as sensitive delivery credentials, but no email content. Do not commit database exports or log subscription endpoints. See the backend README for bindings, schema, verification and build instructions.

Disabling notifications removes this device's server subscription and browser subscription. Logging out attempts the same cleanup. If a device is offline during cleanup, revoke the site's notification permission in its browser settings; the UI reports cleanup failures. Uninstalling an app is not a server-side deletion signal, so stale subscriptions are also removed when their push provider rejects delivery.

App icons use the existing envelope motif, rendered into the sizes required by the manifest and home screen. They contain no private photograph.
