/**
 * Regression check for cookie-gated redirect chains (e.g. Yahoo's consent
 * flow): the article URL redirects to a consent host that sets a cookie and
 * only redirects back to the article if that cookie is sent on later hops.
 *
 * Run from web/: npx tsx scripts/repro-consent-redirect.ts
 * Exits 0 if extractArticle returns the real article, 1 if it gets the
 * consent page (the bug) or fails.
 */
import http from "node:http";
import { extractArticle } from "../src/lib/extract";

const ARTICLE_HTML = `<!doctype html><html><head><title>Real Article</title></head>
<body><article><h1>Real Article</h1>
${'<p>This is the actual readable article content that Readability should find. It has plenty of words so the parser treats it as the main body of the page.</p>'.repeat(10)}
</article></body></html>`;

const CONSENT_HTML = `<!doctype html><html><head><title>Before you continue</title></head>
<body><div><p>We and our partners need your consent. Please accept cookies to continue to the site you requested.</p></div></body></html>`;

const server = http.createServer((req, res) => {
  const cookies = req.headers.cookie ?? "";
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/article") {
    if (cookies.includes("consent=yes")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ARTICLE_HTML);
    } else {
      // Hop 1: bounce to the consent collector, setting a session cookie.
      res.writeHead(302, {
        "set-cookie": "gucs=1; Path=/",
        location: "/collect?dest=/article",
      });
      res.end();
    }
    return;
  }

  if (url.pathname === "/collect") {
    if (cookies.includes("gucs=1")) {
      // Hop 2: cookie survived the redirect -> grant consent, send back.
      res.writeHead(302, {
        "set-cookie": "consent=yes; Path=/",
        location: url.searchParams.get("dest") ?? "/article",
      });
      res.end();
    } else {
      // Cookie lost between hops -> dead-end consent page (the bug).
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(CONSENT_HTML);
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const result = await extractArticle(`http://127.0.0.1:${port}/article`);
    if (result.title === "Real Article") {
      console.log("PASS: extracted the real article through the consent redirect chain");
      process.exitCode = 0;
    } else {
      console.error(`FAIL: extracted wrong page, title = ${JSON.stringify(result.title)}`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`FAIL: extraction threw: ${err}`);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
