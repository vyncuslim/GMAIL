import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend } from "@/lib/resend";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const direction = new URL(request.url).searchParams.get("direction");
  const resend = getResend();

  if (direction === "sent") {
    const { data, error } = await resend.emails.get(id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await resend.emails.receiving.get(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
