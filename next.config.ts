import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AgentKit and the CDP SDK pull Node only dependencies that break when
  // bundled: the production build fails to evaluate any route importing
  // them ("Y is not a function"). Node requires them from node_modules
  // at runtime instead. Every route that touches them declares the Node
  // runtime; none run on Edge.
  serverExternalPackages: ["@coinbase/agentkit", "@coinbase/cdp-sdk"],
};

export default nextConfig;
