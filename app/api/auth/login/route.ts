import { NextResponse } from "next/server";
import { makeSession, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function redirectToLogin(request: Request, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const configured = process.env.MAIL_APP_PASSWORD;
  const contentType = request.headers.get("content-type") || "";
  const isForm = contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  if (!configured) {
    return isForm
      ? redirectToLogin(request, "config")
      : noStoreJson({ error: "MAIL_APP_PASSWORD is not configured on Vercel." }, 503);
  }

  let password = "";
  if (isForm) {
    const form = await request.formData().catch(() => null);
    password = String(form?.get("password") || "");
  } else {
    const body = await request.json().catch(() => ({}));
    password = String((body as any).password || "");
  }

  if (password !== configured) {
    return isForm
      ? redirectToLogin(request, "incorrect")
      : noStoreJson({ error: "Incorrect password." }, 401);
  }

  let session: string;
  try {
    session = makeSession();
  } catch {
    return isForm
      ? redirectToLogin(request, "session")
      : noStoreJson({ error: "SESSION_SECRET is not configured on Vercel." }, 503);
  }

  const response = isForm
    ? NextResponse.redirect(new URL("/", request.url), 303)
    : noStoreJson({ ok: true });

  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
