import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend, isDomainAddress } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const direction = new URL(request.url).searchParams.get("direction");
  const resend = getResend();

  if (direction === "sent") {
    const { data, error } = await resend.emails.get(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || !isDomainAddress((data as any).from)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const attachments = await resend.emails.attachments.list({ emailId: id, limit: 100 });
    return NextResponse.json({
      ...data,
      direction: "sent",
      attachments: attachments.data?.data || [],
    });
  }

  const { data, error } = await resend.emails.receiving.get(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || !isDomainAddress((data as any).to)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const attachments = await resend.emails.receiving.attachments.list({ emailId: id, limit: 100 });
  return NextResponse.json({
    ...data,
    direction: "inbox",
    attachments: attachments.data?.data || [],
  });
}
