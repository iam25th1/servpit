import type { NextConfig } from "next";

/**
 * The headers every response carries.
 *
 * The content security policy is not here: it needs a nonce that changes per
 * request, and a header in this file is the same on every one. It is in
 * src/proxy.ts. These are the ones that do not change.
 *
 * HSTS is sent whatever the host, because it is only honoured over https and
 * a deployment that is not on https has bigger problems than this header.
 */
const SECURITY_HEADERS = [
  // No sniffing a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No framing, which is the clickjacking answer for browsers that predate
  // frame-ancestors in the policy.
  { key: "X-Frame-Options", value: "DENY" },
  // A referrer that never carries a path off site.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here needs a camera, a microphone, a location or a payment sheet.
  { key: "Permissions-Policy", value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Nothing here is served from another origin, and nothing here should be
  // read by one.
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // AgentKit and the CDP SDK pull Node only dependencies that break when
  // bundled: the production build fails to evaluate any route importing
  // them ("Y is not a function"). Node requires them from node_modules
  // at runtime instead. Every route that touches them declares the Node
  // runtime; none run on Edge.
  serverExternalPackages: ["@coinbase/agentkit", "@coinbase/cdp-sdk"],
};

export default nextConfig;
