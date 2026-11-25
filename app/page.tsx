import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import MailClient from "./mail-client";
import { loginDestination, notificationDestination } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: {
  searchParams: Promise<{ notification?: string | string[] }>;
}) {
  const { notification } = await searchParams;
  if (!(await isAuthenticated())) redirect(loginDestination(notificationDestination(notification)));
  return <MailClient />;
}
