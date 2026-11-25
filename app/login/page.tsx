import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { safeMailReturn } from "@/lib/navigation";

export const dynamic = "force-dynamic";

type LoginProps = {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
};

function errorMessage(reason?: string) {
  if (reason === "notifications") return "你已退出登录，但此设备的通知清理未完成。请在浏览器或系统设置中关闭此网站的通知。";
  if (reason === "incorrect") return "Incorrect password.";
  if (reason === "config") return "MAIL_APP_PASSWORD is not configured on Vercel.";
  if (reason === "session") return "SESSION_SECRET is not configured on Vercel.";
  return "";
}

export default async function Login({ searchParams }: LoginProps) {
  const { error, next } = await searchParams;
  const destination = safeMailReturn(next);
  let authenticated = false;
  try {
    authenticated = await isAuthenticated();
  } catch {
    // Keep the login form usable even when session configuration is broken.
  }
  if (authenticated) redirect(destination);
  const message = errorMessage(typeof error === "string" ? error : undefined);

  return (
    <main className="login-shell">
      <form className="login-card" method="POST" action="/api/auth/login">
        <input type="hidden" name="next" value={destination} />
        <div className="mail-mark">M</div>
        <h1>Vyncuslim Mail</h1>
        <p>Private webmail · Personal and Vynalth AI</p>
        <input
          type="password"
          name="password"
          placeholder="Private password"
          autoFocus
          autoComplete="current-password"
          required
        />
        <button type="submit">Sign in</button>
        {message && <div className="error">{message}</div>}
      </form>
    </main>
  );
}
