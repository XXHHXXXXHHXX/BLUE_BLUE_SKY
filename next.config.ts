import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 移除 output: 'export' 以启用 API Routes 服务器模式
  distDir: 'dist',
  images: {
    unoptimized: true,
  },
  // 配置webpack以处理服务器端模块
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // 客户端构建时排除服务器端模块
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
        child_process: false,
      };
    } else {
      // 服务器端构建时排除二进制模块
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push(
          'ssh2',
          'node-ssh',
          'cpu-features'
        );
      }
    }
    return config;
  },
};

export default nextConfig;
