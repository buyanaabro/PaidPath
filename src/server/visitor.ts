import { cookies } from "next/headers";
import { newVisitorToken, validVisitorToken, VISITOR_COOKIE, VISITOR_MAX_AGE_S } from "./demo";

/** The visitor id from the cookie (read-only; Server Components). */
export async function readVisitor() {
  const value = (await cookies()).get(VISITOR_COOKIE)?.value;
  return validVisitorToken(value) ? value : null;
}

/** The visitor id, creating the cookie if needed (Server Functions / Route Handlers only). */
export async function ensureVisitor() {
  const store = await cookies();
  const existing = store.get(VISITOR_COOKIE)?.value;
  if (validVisitorToken(existing)) return existing;
  const token = newVisitorToken();
  store.set(VISITOR_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_MAX_AGE_S,
    path: "/",
  });
  return token;
}
