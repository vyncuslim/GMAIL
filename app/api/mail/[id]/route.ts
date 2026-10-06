import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getResend } from "@/lib/resend";

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

function belongsToVyncuslim(value: unknown) {
  return normalizeAddress(value).some((address) => address.endsWith("@vyncuslim.com"));
}

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
    if (!data || !belongsToVyncuslim((data as any).from)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  const { data, error } = await resend.emails.receiving.get(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || !belongsToVyncuslim((data as any).to)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
