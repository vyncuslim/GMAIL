"use client";

import { FormEvent, useEffect, useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/status", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.ok && data.authenticated) {
          window.location.replace("/");
          return;
        }
        setChecking(false);
      })
      .catch(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Unable to sign in.");
        return;
      }

      const verify = await fetch("/api/auth/status", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const session = await verify.json().catch(() => ({}));

      if (!verify.ok || !session.authenticated) {
        setError("Password was accepted, but the secure session cookie was not saved. Reload and try again.");
        return;
      }

      window.location.replace("/");
    } catch {
      setError("Unable to reach the sign-in service. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="mail-mark">M</div>
        <h1>Vyncuslim Mail</h1>
        <p>Private webmail · @vyncuslim.com</p>
        <input
          type="password"
          placeholder="Private password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          disabled={checking || submitting}
        />
        <button disabled={checking || submitting || !password}>
          {checking ? "Checking…" : submitting ? "Signing in…" : "Sign in"}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}
