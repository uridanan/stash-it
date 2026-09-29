import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (server.js + minimal node_modules)
  // so the Docker runtime image stays small. See web/Dockerfile.
  output: "standalone",
  // jsdom (article extraction), pdfkit (PDF export) and nodemailer (Send to
  // Kindle) must not be bundled by the Next compiler — each resolves its own
  // assets or transports with a runtime require().
  serverExternalPackages: ["jsdom", "pdfkit", "nodemailer"],
};

export default nextConfig;
