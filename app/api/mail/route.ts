import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { addressList, migrateLegacyAddress, extractEmail, getResend, getMailAccount, resolveSender, canAccessMailbox, isVynalthConfigured, encodeMailId, decodeMailId, type MailAccount } from "@/lib/resend";

export const dynamic = "force-dynamic";

async function copyProviderAttachments(
  source: { id?: string; direction?: "inbox" | "sent" } | undefined,
) {
  if (!source?.id) return [];
  const ref = decodeMailId(source.id);
  if (!ref || (source.direction !== "inbox" && source.direction !== "sent")) throw new Error("Invalid attachment source.");
  const resend = getResend(ref.account);

  if (source.direction === "sent") {
    const message = await resend.emails.get(ref.id);
    if (message.error || !message.data || !canAccessMailbox((message.data as any).from, ref.account)) throw new Error("Attachment source is unavailable.");
    const listed = await resend.emails.attachments.list({ emailId: ref.id, limit: 100 });
    if (listed.error) return [];
    const copied = [];
    for (const item of listed.data?.data || []) {
      const detail = await resend.emails.attachments.get({ emailId: ref.id, id: item.id });
      if (!detail.data?.download_url) continue;
      const response = await fetch(detail.data.download_url);
      if (!response.ok) continue;
      copied.push({
        filename: detail.data.filename || "attachment",
        content: Buffer.from(await response.arrayBuffer()),
        contentType: detail.data.content_type,
      });
    }
    return copied;
  }

  const message = await resend.emails.receiving.get(ref.id);
  if (message.error || !message.data || !canAccessMailbox((message.data as any).to, ref.account)) throw new Error("Attachment source is unavailable.");
  const listed = await resend.emails.receiving.attachments.list({ emailId: ref.id, limit: 100 });
  if (listed.error) return [];
  const copied = [];
  for (const item of listed.data?.data || []) {
    const detail = await resend.emails.receiving.attachments.get({ emailId: ref.id, id: item.id });
    if (!detail.data?.download_url) continue;
    const response = await fetch(detail.data.download_url);
    if (!response.ok) continue;
    copied.push({
      filename: detail.data.filename || "attachment",
      content: Buffer.from(await response.arrayBuffer()),
      contentType: detail.data.content_type,
    });
  }
  return copied;
}

async function listAccount(account: MailAccount, folder: "inbox" | "sent") {
  const resend = getResend(account);
  const { data, error } = folder === "sent"
    ? await resend.emails.list({ limit: 100 })
    : await resend.emails.receiving.list({ limit: 100 });
  if (error) throw new Error("Resend request failed");
  return (data?.data || [])
    .filter((message: any) => canAccessMailbox(folder === "sent" ? message.from : message.to, account))
    .map((message: any) => ({
      id: encodeMailId(account, message.id),
      direction: folder,
      from: message.from,
      to: message.to,
      subject: message.subject || "(no subject)",
      date: message.created_at,
    }));
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const folder = new URL(request.url).searchParams.get("folder") === "sent" ? "sent" : "inbox";
  const accounts: MailAccount[] = isVynalthConfigured() ? ["personal", "vynalth"] : ["personal"];
  const results = await Promise.allSettled(accounts.map((account) => listAccount(account, folder)));
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const warnings: string[] = [];
  if (!isVynalthConfigured()) warnings.push("Vynalth AI mail is not configured. Set its server-side API key and mailbox allowlist.");
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      warnings.push((accounts[index] === "personal" ? "Personal" : "Vynalth AI") + " mail could not be loaded. Check its Resend configuration.");
    }
  });
  return NextResponse.json({ items, warnings }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid mail request" }, { status: 400 });
  const from = migrateLegacyAddress(String(body.from || "").trim());
  const to = addressList(body.to).map(migrateLegacyAddress);
  const cc = addressList(body.cc).map(migrateLegacyAddress);
  const bcc = addressList(body.bcc).map(migrateLegacyAddress);
  const replyTo = addressList(body.replyTo).map(migrateLegacyAddress);

  const selectedAccount = getMailAccount(from);
  if (!selectedAccount) {
    return NextResponse.json({ error: "From must use one of the four supported mail domains." }, { status: 400 });
  }
  if (selectedAccount === "vynalth" && !isVynalthConfigured()) {
    return NextResponse.json({ error: "Vynalth AI mail is not configured in the server environment." }, { status: 503 });
  }
  const account = resolveSender(from);
  if (!account) {
    return NextResponse.json({ error: "Sender is not authorized for this mailbox." }, { status: 403 });
  }
  if (!to.length) {
    return NextResponse.json({ error: "Recipient required" }, { status: 400 });
  }
  if ([...to, ...cc, ...bcc, ...replyTo].some((email) => !extractEmail(email))) {
    return NextResponse.json({ error: "Invalid recipient address" }, { status: 400 });
  }
  if (to.length + cc.length + bcc.length > 50) {
    return NextResponse.json({ error: "Maximum 50 recipients per email" }, { status: 400 });
  }

  const clientAttachments = Array.isArray(body.attachments)
    ? body.attachments.slice(0, 20).map((a: any) => ({
        filename: String(a.filename || "attachment"),
        content: String(a.content || ""),
        contentType: a.contentType ? String(a.contentType) : undefined,
      }))
    : [];

  try {
  const resend = getResend(account);
  const copiedAttachments = await copyProviderAttachments(body.copyAttachmentsFrom);
  const headers: Record<string, string> = {};
  if (body.inReplyTo) headers["In-Reply-To"] = String(body.inReplyTo);
  if (body.references) headers["References"] = String(body.references);

  const { data, error } = await resend.emails.send({
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: replyTo.length ? replyTo : undefined,
    subject: body.subject || "(no subject)",
    text: body.text || undefined,
    html: body.html || undefined,
    attachments: [...clientAttachments, ...copiedAttachments].length
      ? [...clientAttachments, ...copiedAttachments]
      : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    scheduledAt: body.scheduledAt || undefined,
  });

  if (error) return NextResponse.json({ error: "Resend rejected this email. Verify the sender domain and account permissions." }, { status: 502 });
  return NextResponse.json({ ok: true, id: data?.id ? encodeMailId(account, data.id) : undefined });
  } catch {
    return NextResponse.json({ error: "Unable to send email. Check the selected mail account and attachments." }, { status: 502 });
  }
}
