import { NextResponse } from "next/server";
import { makeSession, SESSION_COOKIE } from "@/lib/auth";
import { loginDestination, safeMailReturn } from "@/lib/navigation";

export const dynamic = "force-dynamic";

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function redirectToLogin(request: Request, reason: string, next: string) {
  const response = NextResponse.redirect(new URL(loginDestination(next, reason), request.url), 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const configured = process.env.MAIL_APP_PASSWORD;
  const contentType = request.headers.get("content-type") || "";
  const isForm = contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  let password = "";
  let next = "/";
  if (isForm) {
    const form = await request.formData().catch(() => null);
    password = String(form?.get("password") || "");
    next = safeMailReturn(form?.get("next"));
  } else {
    const body = await request.json().catch(() => ({}));
    password = String((body as Record<string, unknown>).password || "");
  }

  if (!configured) {
    return isForm
      ? redirectToLogin(request, "config", next)
      : noStoreJson({ error: "MAIL_APP_PASSWORD is not configured on Vercel." }, 503);
  }

  if (password !== configured) {
    return isForm
      ? redirectToLogin(request, "incorrect", next)
      : noStoreJson({ error: "Incorrect password." }, 401);
  }

  let session: string;
  try {
    session = makeSession();
  } catch {
    return isForm
      ? redirectToLogin(request, "session", next)
      : noStoreJson({ error: "SESSION_SECRET is not configured on Vercel." }, 503);
  }

  const response = isForm
    ? NextResponse.redirect(new URL(next, request.url), 303)
    : noStoreJson({ ok: true });
  response.headers.set("cache-control", "no-store");

  response.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
