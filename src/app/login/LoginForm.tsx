"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="card" style={{ display: "grid", gap: 14 }}>
      <div className="field">
        <label htmlFor="username">Who are you?</label>
        <select id="username" name="username" required defaultValue="">
          <option value="" disabled>
            Choose
          </option>
          <option value="michael">Michael</option>
          <option value="leah">Leah</option>
          <option value="eve">Eve</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
