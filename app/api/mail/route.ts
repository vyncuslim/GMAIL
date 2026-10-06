import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend, senderAddress } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder") || "inbox";
  const resend = getResend();

  if (folder === "sent") {
    const { data, error } = await resend.emails.list({ limit: 50 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      items: (data?.data || []).map((m: any) => ({
        id: m.id,
        direction: "sent",
        from: m.from,
        to: m.to,
        subject: m.subject || "(no subject)",
        date: m.created_at,
      }))
    });
  }

  const { data, error } = await resend.emails.receiving.list({ limit: 50 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    items: (data?.data || []).map((m: any) => ({
      id: m.id,
      direction: "inbox",
      from: m.from,
      to: m.to,
      subject: m.subject || "(no subject)",
      date: m.created_at,
    }))
  });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json();
  const to = Array.isArray(body.to) ? body.to : [body.to].filter(Boolean);
  if (!to.length) return NextResponse.json({ error: "Recipient required" }, { status: 400 });

  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: senderAddress(),
    to,
    cc: body.cc || undefined,
    bcc: body.bcc || undefined,
    replyTo: body.replyTo || undefined,
    subject: body.subject || "(no subject)",
    text: body.text || "",
    html: body.html || undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}
