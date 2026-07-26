import { readFile } from "node:fs/promises";
// Tiny static file server for e2e fixtures.
//
// `npx serve` (the brief's original choice) does not send
// `Access-Control-Allow-Origin` by default (verified: a plain GET against a
// local `serve` instance returns no ACAO header at all). The site under test
// is served from the Vite preview origin (:4173) and fetches fixture JSON
// from this server's origin (:4174) via `fetch()` — different origin, so a
// missing ACAO header makes the browser reject the response and the site's
// `fetchSnapshot()` swallows it as a network error, and the board never
// leaves "stale". This server sends a permissive `Access-Control-Allow-Origin: *`
// on every response so the smoke test can observe the "live" state.
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const PORT = 4174;

const CONTENT_TYPES = {
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", "http://localhost");
  const relPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, relPath);
  try {
    const body = await readFile(filePath);
    res.setHeader("Content-Type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
    res.writeHead(200);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`fixture server listening on http://127.0.0.1:${PORT}`);
});
