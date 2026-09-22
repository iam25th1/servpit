// The content security policy, with a fresh nonce per request.
//
// This site is a canvas game with its own assets and no third party anything:
// no analytics, no fonts from a CDN, no embeds, no remote images. So the
// policy is self and nothing else, and the only reason it needs a nonce at
// all is Next's own inline bootstrap script.
//
// Styles are the one loosening. The nine patch panels, the stage fit and the
// tooltips all set style attributes from values computed at render time, and
// a nonce cannot cover a style attribute: only style-src 'unsafe-inline' can.
// That is a far smaller surface than script execution, which stays nonce
// bound with strict-dynamic so an injected script tag cannot run.
//
// Set here rather than in next.config.ts because the nonce has to change per
// request, and a header in the config is the same on every one.

import { NextResponse, type NextRequest } from "next/server";

/** The policy, with this request's nonce, as one header value. */
export function cspFor(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    // strict-dynamic: scripts Next loads from the bootstrap inherit trust,
    // and nothing else runs. unsafe-eval only in development, where React
    // uses eval to rebuild server stacks in the browser.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // data: for the one place a sprite is read back as a data url, and blob:
    // for the canvases the game draws into.
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self'",
    // The only things fetched are this site's own routes and its own assets.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = cspFor(nonce, process.env.NODE_ENV === "development");

  // On the request as well, which is how Next finds the nonce to put on its
  // own inline script. Without it the bootstrap is blocked and nothing boots.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Everything a browser renders, and nothing it does not: the assets under
  // /assets are served by the static handler and carry no markup to protect.
  matcher: ["/((?!_next/static|_next/image|assets|favicon.ico).*)"],
};
