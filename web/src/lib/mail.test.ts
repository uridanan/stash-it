import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  looksLikeEmail,
  mailAccountView,
  mailConfig,
  mailSender,
  resolveMailConfig,
  type StoredSmtp,
} from "@/lib/mail";

const KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_TRANSPORT",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("mailConfig", () => {
  it("is null when nothing is configured", () => {
    expect(mailConfig()).toBeNull();
    expect(mailSender()).toBeNull();
  });

  it("is null with a host but no sender", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    expect(mailConfig()).toBeNull();
  });

  it("is null with a sender but no host", () => {
    // Nothing to send through — the feature must stay hidden rather than
    // failing at the moment someone uses it.
    process.env.SMTP_FROM = "stash@example.com";
    expect(mailConfig()).toBeNull();
  });

  it("reads a full configuration", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASSWORD = "pass";
    process.env.SMTP_FROM = "stash@example.com";

    expect(mailConfig()).toEqual({
      host: "smtp.example.com",
      port: 2525,
      secure: false,
      user: "user",
      pass: "pass",
      from: "stash@example.com",
      dryRun: false,
    });
    expect(mailSender()).toBe("stash@example.com");
  });

  it("defaults to submission on 587", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    expect(mailConfig()?.port).toBe(587);
    expect(mailConfig()?.secure).toBe(false);
  });

  it("turns on implicit TLS for 465 without being told", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    process.env.SMTP_PORT = "465";
    expect(mailConfig()?.secure).toBe(true);
  });

  it("ignores a port that is not a number", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    process.env.SMTP_PORT = "not-a-port";
    expect(mailConfig()?.port).toBe(587);
  });

  it("needs only a sender in dry-run mode", () => {
    // What the e2e suite runs with: messages are built and addressed, but
    // never delivered.
    process.env.SMTP_TRANSPORT = "json";
    process.env.SMTP_FROM = "stash@example.com";
    const config = mailConfig();
    expect(config?.dryRun).toBe(true);
    expect(config?.from).toBe("stash@example.com");
  });

  it("treats blank values as absent", () => {
    process.env.SMTP_HOST = "   ";
    process.env.SMTP_FROM = "stash@example.com";
    expect(mailConfig()).toBeNull();
  });
});

const emptySmtp = (): StoredSmtp => ({
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPassword: null,
  smtpFrom: null,
});

describe("resolveMailConfig", () => {
  it("uses the environment when Admin has not saved an account", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    expect(resolveMailConfig(emptySmtp())?.from).toBe("stash@example.com");
    expect(resolveMailConfig(null)?.host).toBe("smtp.example.com");
  });

  it("prefers a complete account saved in Admin", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    process.env.SMTP_PASSWORD = "env-secret";
    const config = resolveMailConfig({
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpUser: "sender@gmail.com",
      smtpPassword: "app-password",
      smtpFrom: "sender@gmail.com",
    });
    expect(config).toEqual({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "sender@gmail.com",
      pass: "app-password",
      from: "sender@gmail.com",
      dryRun: false,
    });
  });

  it("keeps the environment when the saved account has no host", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "stash@example.com";
    expect(
      resolveMailConfig({ ...emptySmtp(), smtpFrom: "sender@gmail.com" })?.from,
    ).toBe("stash@example.com");
  });

  it("accepts a saved address alone while dry-run is on", () => {
    process.env.SMTP_TRANSPORT = "json";
    process.env.SMTP_FROM = "stash-e2e@example.com";
    const config = resolveMailConfig({
      ...emptySmtp(),
      smtpFrom: "sender@gmail.com",
    });
    expect(config?.dryRun).toBe(true);
    expect(config?.from).toBe("sender@gmail.com");
    expect(config?.port).toBe(587);
  });
});

describe("mailAccountView", () => {
  it("reports the environment account, including its password", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_USER = "sender@example.com";
    process.env.SMTP_PASSWORD = "env-secret";
    process.env.SMTP_FROM = "sender@example.com";
    expect(mailAccountView(emptySmtp())).toEqual({
      from: "sender@example.com",
      host: "smtp.example.com",
      port: 2525,
      user: "sender@example.com",
      password: "env-secret",
      source: "environment",
    });
  });

  it("reports a saved account ahead of the environment", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "env@example.com";
    process.env.SMTP_PASSWORD = "env-secret";
    expect(
      mailAccountView({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpUser: "saved@example.com",
        smtpPassword: "saved-secret",
        smtpFrom: "saved@example.com",
      }).source,
    ).toBe("saved");
  });
});

describe("looksLikeEmail", () => {
  it("accepts an ordinary address", () => {
    expect(looksLikeEmail("someone@kindle.com")).toBe(true);
    expect(looksLikeEmail("  someone@free.kindle.com  ")).toBe(true);
  });

  it("rejects what is plainly not one", () => {
    expect(looksLikeEmail("")).toBe(false);
    expect(looksLikeEmail("someone")).toBe(false);
    expect(looksLikeEmail("someone@localhost")).toBe(false);
    expect(looksLikeEmail("two @spaces.com")).toBe(false);
  });
});
