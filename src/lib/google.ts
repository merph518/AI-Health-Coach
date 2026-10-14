import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Google sign-in: OpenID Connect authorization-code flow with PKCE.
// The ID token comes straight from Google's token endpoint over TLS, so per
// OIDC Core 3.1.3.7 its claims are checked rather than its signature.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_COOKIE = "google_oauth";

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  return { clientId, clientSecret, redirectUri: new URL("/auth/google/callback", appUrl).toString() };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function startAuth(cfg: NonNullable<ReturnType<typeof googleConfig>>) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url, cookie: `${state}.${verifier}` };
}

/** Exchanges the code and returns the verified, lowercased email, or null. */
export async function finishAuth(cfg: NonNullable<ReturnType<typeof googleConfig>>, code: string, verifier: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) return null;
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as {
    iss?: string;
    aud?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
  };
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issOk || claims.aud !== cfg.clientId || !claims.exp || claims.exp * 1000 < Date.now()) return null;
  if (!claims.email || claims.email_verified !== true) return null;
  return claims.email.toLowerCase();
}
