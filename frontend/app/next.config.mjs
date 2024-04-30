/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Only change the config for client-side and development.
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,      // Check for changes every second
        aggregateTimeout: 300,  // Delay the rebuild after the first change
      };
    }

    // Important: return the modified config
    return config;
  },
};

export default nextConfig;
