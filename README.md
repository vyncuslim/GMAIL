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
