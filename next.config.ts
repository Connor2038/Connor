import type { NextConfig } from 'next';
const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};
export default config;
