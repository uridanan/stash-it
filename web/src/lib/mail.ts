import nodemailer from "nodemailer";

/**
 * Outbound mail for Send to Kindle.
 *
 * The account is a system setting, edited in Admin. SMTP_* in the environment
 * is the fallback when Admin has not saved one, which is also how the e2e
 * suite points at a dry-run transport. The password is never returned by the
 * API and is not part of a library backup.
 *
 * The From address is shown in Settings, because Amazon only accepts mail
 * from an address on your Approved Personal Document E-mail List — you cannot
 * approve what you cannot see.
 *
 * `SMTP_TRANSPORT=json` builds the message and returns it instead of
 * delivering it. That is what the e2e suite runs with: it exercises the whole
 * path, attachment included, without needing a mail server or sending real
 * mail from a test.
 */

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
  /** True when messages are built but never delivered (tests). */
  dryRun: boolean;
}

export class MailError extends Error {}

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The configured transport, or null when the app was started without one.
 *
 * Read per call rather than cached: this is a long-lived server and an
 * operator changing the environment should not need a code change to take
 * effect, only a restart of the process they already restarted.
 */
export function mailConfig(): MailConfig | null {
  const dryRun = env("SMTP_TRANSPORT") === "json";
  const from = env("SMTP_FROM");
  const host = env("SMTP_HOST");
  if (!from) return null;
  if (!dryRun && !host) return null;

  const port = Number(env("SMTP_PORT") ?? "587");
  return {
    host: host ?? "localhost",
    port: Number.isFinite(port) ? port : 587,
    // Implicit TLS on 465; everything else upgrades with STARTTLS.
    secure: env("SMTP_SECURE") === "true" || port === 465,
    user: env("SMTP_USER"),
    pass: env("SMTP_PASSWORD"),
    from,
    dryRun,
  };
}

/** Account saved in Admin. Empty strings are treated as unset. */
export interface StoredSmtp {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
}

/**
 * Admin's account when it is complete, otherwise the environment.
 * A saved From address without a host is incomplete, so the environment
 * still applies — except in dry-run, which only needs the address.
 */
export function resolveMailConfig(
  stored: StoredSmtp | null | undefined,
): MailConfig | null {
  const from = clean(stored?.smtpFrom);
  const host = clean(stored?.smtpHost);
  const dryRun = env("SMTP_TRANSPORT") === "json";
  if (from && (host || dryRun)) {
    const port = smtpPort(stored?.smtpPort);
    return {
      host: host ?? "localhost",
      port,
      secure: port === 465,
      user: clean(stored?.smtpUser),
      pass: clean(stored?.smtpPassword),
      from,
      dryRun,
    };
  }
  return mailConfig();
}

function smtpPort(value: number | null | undefined): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
    ? value
    : 587;
}

export interface MailAccountView {
  from: string;
  host: string;
  port: number;
  user: string;
  password: string;
  /** Where the values came from. "none" means nothing is configured. */
  source: "saved" | "environment" | "none";
}

/**
 * The account Send to Kindle will use, for Admin to display.
 * A dry-run placeholder host is not shown as if someone configured it.
 */
export function mailAccountView(
  stored: StoredSmtp | null | undefined,
): MailAccountView {
  const resolved = resolveMailConfig(stored);
  if (!resolved) {
    return {
      from: "",
      host: "",
      port: 587,
      user: "",
      password: "",
      source: "none",
    };
  }

  const savedFrom = clean(stored?.smtpFrom);
  const savedHost = clean(stored?.smtpHost);
  const usingSaved = Boolean(savedFrom && (savedHost || resolved.dryRun));
  return {
    from: resolved.from,
    host: usingSaved ? (savedHost ?? "") : resolved.host,
    port: resolved.port,
    user: resolved.user ?? "",
    password: resolved.pass ?? "",
    source: usingSaved ? "saved" : "environment",
  };
}

/** The account actually used to send, including the environment fallback. */
export async function loadMailConfig(): Promise<MailConfig | null> {
  const { getSystemSettings } = await import("@/lib/system-settings");
  const system = await getSystemSettings();
  return resolveMailConfig(system);
}

/** The address mail arrives from, for the settings page to display. */
export function mailSender(): string | null {
  return mailConfig()?.from ?? null;
}

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
}

/** Sends one message, or throws MailError with something worth showing a user. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const config = await loadMailConfig();
  if (!config) {
    throw new MailError(
      "The sending account is not configured",
    );
  }

  // Two calls rather than one with a union argument: nodemailer's overloads
  // pick a different options type per transport, and a union satisfies neither.
  const transport = config.dryRun
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user && config.pass
          ? { auth: { user: config.user, pass: config.pass } }
          : {}),
      });

  try {
    await transport.sendMail({ from: config.from, ...mail });
  } catch (err) {
    // The underlying error names the host and sometimes the credentials, so
    // only its message is surfaced and the rest goes to the server log.
    console.error("Mail send failed:", err);
    throw new MailError(
      err instanceof Error ? err.message : "The mail server refused the message",
    );
  }
}

/** A plausible email address. Deliberately loose — the mail server decides. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value.trim());
}
