import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { googleConfig } from "@/lib/google";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Scale & Plate" };

const ERRORS: Record<string, string> = {
  google: "Google sign-in didn’t finish. Please try again.",
  "not-allowed": "That Google account isn’t one of ours. Use the account linked to your profile.",
  "google-off": "Google sign-in isn’t set up on this server yet.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await currentUser()) redirect("/");
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  const google = googleConfig() != null;

  return (
    <main className="shell" style={{ maxWidth: 380, paddingTop: "12vh", display: "grid", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>Scale &amp; Plate</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Fagerteam health coach
        </p>
      </div>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      {google && (
        // A plain link: the route handler starts the OAuth redirect.
        <a href="/auth/google" className="btn btn-primary" style={{ justifyContent: "center", textAlign: "center" }}>
          Sign in with Google
        </a>
      )}
      {google ? (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 14 }}>
            Use a password instead
          </summary>
          <div style={{ marginTop: 12 }}>
            <LoginForm />
          </div>
        </details>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
