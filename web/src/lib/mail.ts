import nodemailer from "nodemailer";

/**
 * Outbound mail.
 *
 * The transport is environment configuration, not user data: the credentials
 * belong to whoever runs the app, and putting them in the database would mean
 * exporting them in a backup or explaining why they are the one setting that
 * is not. The *sender address* is read back out and shown in settings, because
 * Amazon only accepts a Send-to-Kindle mail from an address you have approved
 * in your own Amazon account — you cannot approve what you cannot see.
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
  const config = mailConfig();
  if (!config) {
    throw new MailError(
      "This app has no mail transport configured (SMTP_HOST / SMTP_FROM)",
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
