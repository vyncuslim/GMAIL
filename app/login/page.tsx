"use client";
import { FormEvent, useState } from "react";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) location.href = "/";
    else setError("Incorrect password");
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="mail-mark">M</div>
        <h1>Vyncuslim Mail</h1>
        <p>Private webmail · @vyncuslim.com</p>
        <input type="password" placeholder="Private password" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
        <button>Sign in</button>
        {error && <div className="error">{error}</div>}
      </form>
    </main>
  );
}
