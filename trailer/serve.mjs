// Serves the trailer composition, the game's own assets and one recorded take,
// on loopback only.
//
//   /                 trailer/index.html
//   /assets/...       public/assets/... (fonts, facesets, sounds)
//   /footage/...      trailer/footage/<take>/... (frames and index.json)
//
// Nothing outside those three roots is reachable: every path is resolved and
// checked to still sit inside its root, so "../" gets a 404, not a file.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const take = process.env.TAKE ?? "latest";
const port = Number(process.env.PORT ?? 8088);

const ROOTS = [
  { prefix: "/assets/", dir: join(repo, "public", "assets") },
  { prefix: "/footage/", dir: join(here, "footage", take) },
];
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".wav": "audio/wav", ".ogg": "audio/ogg" };

/** The file a URL path names inside a root, or null when it would leave it. */
function inside(dir, rest) {
  const target = resolve(dir, normalize(decodeURIComponent(rest)).replace(/^([/\\])+/, ""));
  return target === dir || target.startsWith(dir + sep) ? target : null;
}

function locate(pathname) {
  if (pathname === "/" || pathname === "/index.html") return join(here, "index.html");
  for (const root of ROOTS) if (pathname.startsWith(root.prefix)) return inside(root.dir, pathname.slice(root.prefix.length));
  return null;
}

createServer(async (req, res) => {
  try {
    const file = locate(new URL(req.url ?? "/", "http://localhost").pathname);
    if (!file || !(await stat(file)).isFile()) throw new Error("not found");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`trailer on http://127.0.0.1:${port}/ (footage: ${take})`));
