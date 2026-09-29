import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { looksLikeEmail, mailConfig, mailSender } from "@/lib/mail";

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
