import { NextResponse } from "next/server";
import { makeSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configured = process.env.MAIL_APP_PASSWORD;
  if (!configured) {
    return NextResponse.json(
      { error: "MAIL_APP_PASSWORD is not configured on Vercel." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const body = await request.json().catch(() => ({}));
  if (String(body.password || "") !== configured) {
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  let session: string;
  try {
    session = makeSession();
  } catch {
    return NextResponse.json(
      { error: "SESSION_SECRET is not configured on Vercel." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );

  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
