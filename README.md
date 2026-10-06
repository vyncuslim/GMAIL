# Vyncuslim Mail

Private Gmail-style webmail built for Vercel + Resend.

- Web app: `mail.vyncuslim.com`
- Email domain: `@vyncuslim.com`
- Receive mail with Resend Receiving
- Send mail with Resend
- Private password-gated UI

## Required Vercel environment variables

```
RESEND_API_KEY=re_xxx
MAIL_FROM=vyncus@vyncuslim.com
MAIL_APP_PASSWORD=choose-a-strong-private-password
SESSION_SECRET=long-random-secret-at-least-32-bytes
```

## DNS design

`mail.vyncuslim.com` points to Vercel for the web UI.

The MX records for `vyncuslim.com` must point to the mail receiving provider. If Resend is the receiving provider, use the MX records Resend shows when enabling Receiving for `vyncuslim.com`. If the root domain already receives mail through another provider, do not overwrite those MX records; use provider forwarding into Resend instead.

Never commit the Resend API key or private password to GitHub.
