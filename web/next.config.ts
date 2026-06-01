import type { NextConfig } from "next";
// import createMDX from '@next/mdx';
import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin();
const nextConfig: NextConfig = {
  // pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  
  // 注释掉静态导出配置，使用动态渲染（开发和nginx部署时）
  // output: 'export',
  // distDir: 'out',
  
  // 图片优化配置
  images: {
    unoptimized: true,
  },
  
  // 使用默认的 .next 目录，避免路径问题
  // distDir: './dist',
  
  // 防止dev模式下模拟立即卸载组件和重新挂载组件的行为
  reactStrictMode: false,
  
  // 优化构建配置
  webpack: (config, { isServer }) => {
    // 增加chunk加载超时时间
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          default: false,
          vendors: false,
        },
      },
    };
    return config;
  },
  
  // 禁用静态优化以避免chunk加载问题
  experimental: {
    optimizePackageImports: ['@heroui/react'],
  },
};

// const withMDX = createMDX({
//   // Add markdown plugins here, as desired
// })

// export default withMDX(withNextIntl(nextConfig));
export default withNextIntl(nextConfig);
