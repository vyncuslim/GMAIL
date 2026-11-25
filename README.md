# Vyncuslim Mail

Private Gmail-style webmail built for Vercel + Resend.

- Web app: `mail.vyncuslim.com`
- Email domains: `@vyncuslim.com` and `@mail.vyncuslim.com`
- Receive mail for both personal domains when verified in Resend
- Send mail from an address on either allowlisted domain once verified
- Private password-gated UI
- No fixed `MAIL_FROM` environment variable

## Required Vercel environment variables

```
RESEND_API_KEY=re_xxx
MAIL_APP_PASSWORD=choose-a-strong-private-password
SESSION_SECRET=long-random-secret-at-least-32-bytes
```

## Mail behavior

The Inbox and Sent views support both domains with an All domains / individual domain filter. The From field suggests personal addresses, and replies prefer the original receiving or sending address. The server validates exact allowed domains and retains existing session checks on email and attachment routes. A new domain must be verified by Resend before it can send or receive. Resend list/read/send operations require a server-side API key with the corresponding access on the same personal Resend team.

## DNS design

`mail.vyncuslim.com` points to Vercel for the web UI.

Both domains need their respective Resend sending DNS records and receiving MX records. Keep the website's Vercel routing intact and verify that public DNS returns the required MX for each domain. Do not replace the root-domain MX or existing website DNS without checking the current provider.

Never commit the Resend API key or private password to GitHub.
