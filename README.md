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

Both company domains must pass Resend sending and receiving verification. In the `vynalthai.com` zone, the company subdomain MX must use the exact receiving host and priority shown in Resend. Do not overwrite existing personal DNS or web hosting records. The web app uses Resend's receiving API to list mail, so a webhook is not required for the current pull-based mailbox.

After setting server environment variables, redeploy and test sending and receiving with each verified domain. Never expose or reuse the personal key for company mail.

## Legacy SleepSomno migration

Outgoing From, To, Cc, Bcc and Reply-To fields map exact `sleepsomno.com` addresses to `vynalthai.com` and exact `mail.sleepsomno.com` addresses to `mail.vynalthai.com`, preserving the local part. Other domains are untouched. This applies only to this webmail app and does not configure old-domain MX, inbound forwarding, third-party SMTP or historical mailbox migration. Configure the legacy domain's actual mail provider separately, retain legacy MX until the new routing is tested, and update any external application SMTP sender settings.

Legacy inbound mail is supported once Resend actually receives it: original recipients are preserved while authorized matching Vynalth addresses are used for inbox filters, reply identity, detail access and attachments. The exact legacy root, www and vitashield addresses map to the new root domain; the old mail subdomain maps to the new mail subdomain. This is an application mailbox alias, not a physical SMTP forward. All legacy receiving domains must be separately onboarded at the provider or use an external forwarding service. No historical Lark mail is imported.

## Logos, photos and signatures

The mailbox shows the Vynalth AI logo for the two corporate domains (and their legacy aliases), and a privately configured photo for the two personal domains. Set `MAIL_PROFILE_PHOTO_URL` as a server-only Vercel environment variable to an HTTPS image URL. The server returns it only in authenticated, non-cacheable mailbox responses and uses that same configuration when composing an outgoing signature. Never add a `NEXT_PUBLIC_` prefix or commit the personal photo URL or bytes. Without configuration, personal addresses keep letter avatars and text-only signatures. Unknown addresses keep letter avatars. This is a display preference, not sender authentication, and there are no third-party avatar lookups for unknown incoming addresses.

New messages and replies offer an **Include logo / photo signature** checkbox with a preview. The preference is saved in each draft. When enabled, the server uses the authorized sender to create both HTML and plain-text signatures, places the new signature before quoted plain-text replies, and adds the brand display name only when the sender has none. Disabling the signature preserves the original sending content. No email is sent when selecting an identity or previewing a signature.

These images affect this webmail and the message body. Gmail and other recipients control their inbox avatar display separately. BIMI requires the receiving provider's authentication and certificate requirements; this change does not create a BIMI record or claim external verification.

Asset provenance: `public/brand/vynalth-logo.svg` is the existing symbol from `vyncuslim/SomnoAI-Digital-Sleep-Lab`, commit `4c4c914df795d5c3d1e7d11ce88c86430e5d62ce`, `public/media/vynalth-mark.svg`. Its PNG is a format conversion with identical artwork. Personal photographs are not stored in this repository. External images remain subject to the receiving email client's image loading and format support.
