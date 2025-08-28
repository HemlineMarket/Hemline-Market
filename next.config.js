/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      // Old static and legacy routes -> new clean route
      { source: '/sell.html', destination: '/list', permanent: true },
      { source: '/seller', destination: '/list', permanent: true },
      { source: '/seller.html', destination: '/list', permanent: true },
      { source: '/seller-dashboard.html', destination: '/list', permanent: true },
    ];
  },
};

module.exports = nextConfig;
