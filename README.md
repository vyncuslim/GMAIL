# Vyncuslim Mail

Private Gmail-style webmail built for Vercel + Resend.

- Web app: `mail.vyncuslim.com`
- Email domain: `@vyncuslim.com`
- Receive mail for the verified `vyncuslim.com` domain
- Send mail from any valid `@vyncuslim.com` address
- Private password-gated UI
- No fixed `MAIL_FROM` environment variable

## Required Vercel environment variables

```
RESEND_API_KEY=re_xxx
MAIL_APP_PASSWORD=choose-a-strong-private-password
SESSION_SECRET=long-random-secret-at-least-32-bytes
```

## Mail behavior

The Inbox displays messages addressed to `@vyncuslim.com`.

When composing, the sender is entered in the **From** field. The server only accepts addresses ending in `@vyncuslim.com`.

## DNS design

`mail.vyncuslim.com` points to Vercel for the web UI.

The MX records for `vyncuslim.com` must point to the mail receiving provider. Resend Receiving is enabled for the verified domain in this setup.

Never commit the Resend API key or private password to GitHub.
