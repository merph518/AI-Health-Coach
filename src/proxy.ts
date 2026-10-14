import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: sends visitors without a session cookie to /login.
// Real verification happens in requireUser() on every page and action.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!login|auth/|api/jobs/|sw.js|icon-|_next/|favicon.ico|icon|manifest).*)"],
};
