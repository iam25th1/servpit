// Serves the trailer page on loopback only.
//
//   /                  docs/trailer/index.html
//   /round.json        docs/trailer/round.json, the replayed round
//   /dist/trailer.js   src/main.ts, bundled in memory by esbuild at start
//   /assets/...        public/assets/... (sprites, faces, the slot, the sounds)
//   /fonts/...         Inter, from @fontsource/inter (OFL), pinned by the lockfile
//
// Nothing else is reachable. Every asset and font path is resolved and checked
// to still sit inside its root, so "../" gets a 404, not a file. The bundle is
// never written to disk, so there is no generated code in the tree to lint or
// to drift from its source.
//
//   node serve.mjs            (PORT=<port> for a port other than 8089)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const assets = join(repo, "public", "assets");
const fonts = join(here, "node_modules", "@fontsource", "inter", "files");
const port = Number(process.env.PORT ?? 8089);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".woff2": "font/woff2" };

const bundle = await build({
  entryPoints: [join(here, "src", "main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  target: "chrome120",
  tsconfig: join(repo, "tsconfig.json"),
  logLevel: "warning",
});
const script = bundle.outputFiles[0].contents;

/** The file a URL path names inside a root, or null when it would leave it. */
function inside(root, rest) {
  const target = resolve(root, normalize(decodeURIComponent(rest)).replace(/^([/\\])+/, ""));
  return target.startsWith(root + sep) ? target : null;
}

function locate(pathname) {
  if (pathname === "/" || pathname === "/index.html") return join(here, "index.html");
  if (pathname === "/round.json") return join(here, "round.json");
  if (pathname.startsWith("/assets/")) return inside(assets, pathname.slice("/assets/".length));
  if (pathname.startsWith("/fonts/")) return inside(fonts, pathname.slice("/fonts/".length));
  return null;
}

export const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/dist/trailer.js") {
      res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      res.end(script);
      return;
    }
    const file = locate(pathname);
    if (!file || !(await stat(file)).isFile()) throw new Error("not found");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

await new Promise((ok) => server.listen(port, "127.0.0.1", ok));
console.log(`trailer on http://127.0.0.1:${port}/`);
