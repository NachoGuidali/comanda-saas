/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    // Las fotos se guardan ya optimizadas (webp de 1200px) al subirlas, así que
    // el optimizador de Next no aporta nada y además necesita sharp compilado
    // para la plataforma del contenedor, que es una fuente de problemas.
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
};
export default nextConfig;
