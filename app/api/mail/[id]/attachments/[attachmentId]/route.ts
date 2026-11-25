import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend, canAccessMailbox, decodeMailId } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, attachmentId } = await context.params;
  const direction = new URL(request.url).searchParams.get("direction");
  const ref = decodeMailId(id);
  if (!ref) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
  const resend = getResend(ref.account);

  if (direction === "sent") {
    const message = await resend.emails.get(ref.id);
    if (message.error || !message.data || !canAccessMailbox((message.data as any).from, ref.account)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const attachment = await resend.emails.attachments.get({ emailId: ref.id, id: attachmentId });
    if (attachment.error || !attachment.data?.download_url) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }
    return NextResponse.redirect(attachment.data.download_url);
  }

  const message = await resend.emails.receiving.get(ref.id);
  if (message.error || !message.data || !canAccessMailbox((message.data as any).to, ref.account)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attachment = await resend.emails.receiving.attachments.get({ emailId: ref.id, id: attachmentId });
  if (attachment.error || !attachment.data?.download_url) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  return NextResponse.redirect(attachment.data.download_url);
  } catch {
    return NextResponse.json({ error: "Mail account or message unavailable" }, { status: 502 });
  }
}
