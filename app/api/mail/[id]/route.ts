import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend, canAccessMailbox, decodeMailId, encodeMailId } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const direction = new URL(request.url).searchParams.get("direction");
  const ref = decodeMailId(id);
  if (!ref) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
  const resend = getResend(ref.account);

  if (direction === "sent") {
    const { data, error } = await resend.emails.get(ref.id);
    if (error) return NextResponse.json({ error: "Message unavailable" }, { status: 404 });
    if (!data || !canAccessMailbox((data as any).from, ref.account)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const attachments = await resend.emails.attachments.list({ emailId: ref.id, limit: 100 });
    return NextResponse.json({
      ...data,
      id: encodeMailId(ref.account, ref.id),
      direction: "sent",
      attachments: attachments.data?.data || [],
    });
  }

  const { data, error } = await resend.emails.receiving.get(ref.id);
  if (error) return NextResponse.json({ error: "Message unavailable" }, { status: 404 });
  if (!data || !canAccessMailbox((data as any).to, ref.account)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attachments = await resend.emails.receiving.attachments.list({ emailId: ref.id, limit: 100 });
  return NextResponse.json({
    ...data,
      id: encodeMailId(ref.account, ref.id),
    direction: "inbox",
    attachments: attachments.data?.data || [],
  });
  } catch {
    return NextResponse.json({ error: "Mail account or message unavailable" }, { status: 502 });
  }
}
