/** @type {import('next').NextConfig} */
// Static export for Cloudflare Pages. The API lives in functions/api (Pages Functions),
// i.e. on the same origin – no CORS, first-party session cookie.
const nextConfig = {
  output: "export",
  trailingSlash: false,
  poweredByHeader: false,
  images: { unoptimized: true },
};
export default nextConfig;
