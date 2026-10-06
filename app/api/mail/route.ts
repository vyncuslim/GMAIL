import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { addressList, getResend, isAllowedSender, isDomainAddress } from "@/lib/resend";

export const dynamic = "force-dynamic";

async function copyProviderAttachments(
  resend: ReturnType<typeof getResend>,
  source: { id?: string; direction?: "inbox" | "sent" } | undefined,
) {
  if (!source?.id) return [];

  if (source.direction === "sent") {
    const message = await resend.emails.get(source.id);
    if (message.error || !message.data || !isDomainAddress((message.data as any).from)) return [];
    const listed = await resend.emails.attachments.list({ emailId: source.id, limit: 100 });
    if (listed.error) return [];
    const copied = [];
    for (const item of listed.data?.data || []) {
      const detail = await resend.emails.attachments.get({ emailId: source.id, id: item.id });
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

  const message = await resend.emails.receiving.get(source.id);
  if (message.error || !message.data || !isDomainAddress((message.data as any).to)) return [];
  const listed = await resend.emails.receiving.attachments.list({ emailId: source.id, limit: 100 });
  if (listed.error) return [];
  const copied = [];
  for (const item of listed.data?.data || []) {
    const detail = await resend.emails.receiving.attachments.get({ emailId: source.id, id: item.id });
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

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const folder = new URL(request.url).searchParams.get("folder") || "inbox";
  const resend = getResend();

  if (folder === "sent") {
    const { data, error } = await resend.emails.list({ limit: 100 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      items: (data?.data || [])
        .filter((m: any) => isDomainAddress(m.from))
        .map((m: any) => ({
          id: m.id,
          direction: "sent",
          from: m.from,
          to: m.to,
          subject: m.subject || "(no subject)",
          date: m.created_at,
        })),
    });
  }

  const { data, error } = await resend.emails.receiving.list({ limit: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data?.data || [])
      .filter((m: any) => isDomainAddress(m.to))
      .map((m: any) => ({
        id: m.id,
        direction: "inbox",
        from: m.from,
        to: m.to,
        subject: m.subject || "(no subject)",
        date: m.created_at,
      })),
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const from = String(body.from || "").trim();
  const to = addressList(body.to);
  const cc = addressList(body.cc);
  const bcc = addressList(body.bcc);

  if (!isAllowedSender(from)) {
    return NextResponse.json({ error: "From must be an @vyncuslim.com address" }, { status: 400 });
  }
  if (!to.length) {
    return NextResponse.json({ error: "Recipient required" }, { status: 400 });
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

  const resend = getResend();
  const copiedAttachments = await copyProviderAttachments(resend, body.copyAttachmentsFrom);
  const headers: Record<string, string> = {};
  if (body.inReplyTo) headers["In-Reply-To"] = String(body.inReplyTo);
  if (body.references) headers["References"] = String(body.references);

  const { data, error } = await resend.emails.send({
    from,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    replyTo: body.replyTo || undefined,
    subject: body.subject || "(no subject)",
    text: body.text || undefined,
    html: body.html || undefined,
    attachments: [...clientAttachments, ...copiedAttachments].length
      ? [...clientAttachments, ...copiedAttachments]
      : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    scheduledAt: body.scheduledAt || undefined,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}
