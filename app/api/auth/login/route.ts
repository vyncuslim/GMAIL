import { NextResponse } from "next/server";
import { setSession } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = await request.json();
  const configured = process.env.MAIL_APP_PASSWORD;
  if (!configured || password !== configured) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  await setSession();
  return NextResponse.json({ ok: true });
}
