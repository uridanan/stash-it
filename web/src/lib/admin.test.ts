import { afterEach, describe, expect, it } from "vitest";

import { ADMIN_EMAIL, isAdminEmail } from "@/lib/admin";

const original = process.env.AUTH_DEV_LOGIN;

afterEach(() => {
  if (original === undefined) delete process.env.AUTH_DEV_LOGIN;
  else process.env.AUTH_DEV_LOGIN = original;
});

describe("isAdminEmail", () => {
  it("accepts the admin address with the dev login off", () => {
    delete process.env.AUTH_DEV_LOGIN;
    expect(isAdminEmail(ADMIN_EMAIL)).toBe(true);
    expect(isAdminEmail(" URIDANAN@gmail.com ")).toBe(true);
    expect(isAdminEmail("dev@example.com")).toBe(false);
    expect(isAdminEmail("other@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });

  it("accepts the dev login only while that login is enabled", () => {
    process.env.AUTH_DEV_LOGIN = "true";
    expect(isAdminEmail("dev@example.com")).toBe(true);
    expect(isAdminEmail("Dev@Example.com")).toBe(true);
    expect(isAdminEmail("other@example.com")).toBe(false);
  });
});
