import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend, senderAddress } from "@/lib/resend";

export const dynamic = "force-dynamic";

function normalizeAddress(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeAddress);
  if (typeof value === "string") {
    const match = value.match(/<([^>]+)>/);
    return [(match?.[1] || value).trim().toLowerCase()];
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return normalizeAddress(obj.email || obj.address || "");
  }
  return [];
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const folder = searchParams.get("folder") || "inbox";
  const resend = getResend();
  const mailbox = senderAddress().toLowerCase();

  if (folder === "sent") {
    const { data, error } = await resend.emails.list({ limit: 100 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = (data?.data || [])
      .filter((m: any) => normalizeAddress(m.from).includes(mailbox))
      .slice(0, 50)
      .map((m: any) => ({
        id: m.id,
        direction: "sent",
        from: m.from,
        to: m.to,
        subject: m.subject || "(no subject)",
        date: m.created_at,
      }));

    return NextResponse.json({ items });
  }

  const { data, error } = await resend.emails.receiving.list({ limit: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data?.data || [])
    .filter((m: any) => normalizeAddress(m.to).includes(mailbox))
    .slice(0, 50)
    .map((m: any) => ({
      id: m.id,
      direction: "inbox",
      from: m.from,
      to: m.to,
      subject: m.subject || "(no subject)",
      date: m.created_at,
    }));

  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const to = Array.isArray(body.to) ? body.to : [body.to].filter(Boolean);
  if (!to.length) {
    return NextResponse.json({ error: "Recipient required" }, { status: 400 });
  }

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
