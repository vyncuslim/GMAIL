import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

type LoginProps = {
  searchParams: Promise<{ error?: string }>;
};

function errorMessage(reason?: string) {
  if (reason === "incorrect") return "Incorrect password.";
  if (reason === "config") return "MAIL_APP_PASSWORD is not configured on Vercel.";
  if (reason === "session") return "SESSION_SECRET is not configured on Vercel.";
  return "";
}

export default async function Login({ searchParams }: LoginProps) {
  try {
    if (await isAuthenticated()) redirect("/");
  } catch {
    // Keep the login form usable even when session configuration is broken.
  }

  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <main className="login-shell">
      <form className="login-card" method="POST" action="/api/auth/login">
        <div className="mail-mark">M</div>
        <h1>Vyncuslim Mail</h1>
        <p>Private webmail · @vyncuslim.com</p>
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
