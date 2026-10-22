/** The account that sees Admin and can change system settings. */
export const ADMIN_EMAIL = "uridanan@gmail.com";

/** Credentials account created by the local dev login. */
const DEV_EMAIL = "dev@example.com";

export function isAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (normalized === ADMIN_EMAIL) return true;
  // AUTH_DEV_LOGIN is set by the local stack and the e2e server, never in
  // production. While it is on, the dev account can open Admin.
  return process.env.AUTH_DEV_LOGIN === "true" && normalized === DEV_EMAIL;
}
