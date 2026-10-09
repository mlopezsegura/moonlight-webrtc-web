// Serves web/ over HTTP. No dependencies.
//
//   node scripts/serve.mjs [--port 8770] [--host 127.0.0.1]
//
// The page must be loaded over http: browsers block ws:// connections from https pages, and
// Sunshine-Web-RTC's signaling server is plain ws://.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(option("--port", process.env.PORT || 8770));
const host = option("--host", "127.0.0.1");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer((request, response) => {
  let path;
  try {
    path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (path.endsWith("/")) {
    path += "index.html";
  }
  const file = normalize(join(root, path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !(extname(file) in TYPES)) {
    response.writeHead(404).end();
    return;
  }
  let size;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) {
      throw new Error("not a file");
    }
    size = stat.size;
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": TYPES[extname(file)],
    "Content-Length": size,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  const shown = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Moonlight WebRTC web client: http://${shown}:${port}/`);
});
