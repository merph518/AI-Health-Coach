"use client";

import { useActionState } from "react";
import { changePassword } from "../actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      <div className="field">
        <label htmlFor="current">Current password</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="next">New password</label>
        <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      {state?.error && <p className="error" role="alert">{state.error}</p>}
      {state?.ok && <p className="ok">{state.ok}</p>}
      <button className="btn btn-primary" disabled={pending} style={{ justifySelf: "start" }}>
        Update password
      </button>
    </form>
  );
}
