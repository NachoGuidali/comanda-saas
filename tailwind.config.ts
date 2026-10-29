import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Los colores de cada cliente: variables CSS que arma src/lib/tema.ts con
      // la marca cargada en Configuración. Ningún color de marca va escrito acá.
      colors: {
        marca:    { DEFAULT: 'rgb(var(--c-marca) / <alpha-value>)', 600: 'rgb(var(--c-marca-600) / <alpha-value>)', 500: 'rgb(var(--c-marca-500) / <alpha-value>)', 300: 'rgb(var(--c-marca-300) / <alpha-value>)' },
        rojo:     { DEFAULT: 'rgb(var(--c-rojo) / <alpha-value>)', 600: 'rgb(var(--c-rojo-600) / <alpha-value>)', 300: 'rgb(var(--c-rojo-300) / <alpha-value>)' },
        'sobre-rojo': 'rgb(var(--c-sobre-rojo) / <alpha-value>)',
        crema:    { DEFAULT: 'rgb(var(--c-crema) / <alpha-value>)', 200: 'rgb(var(--c-crema-200) / <alpha-value>)' },
        ladrillo: { DEFAULT: 'rgb(var(--c-ladrillo) / <alpha-value>)', 600: 'rgb(var(--c-ladrillo-600) / <alpha-value>)' },
        carbon:   { DEFAULT: 'rgb(var(--c-carbon) / <alpha-value>)', 700: 'rgb(var(--c-carbon-700) / <alpha-value>)', 500: 'rgb(var(--c-carbon-500) / <alpha-value>)' },
        // Solo para confirmaciones: cobrado, stock repuesto, reserva confirmada
        verde:    { DEFAULT: 'rgb(var(--c-verde) / <alpha-value>)', 600: 'rgb(var(--c-verde-600) / <alpha-value>)' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Impact', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '20px' },
      boxShadow: { card: '0 1px 2px rgb(var(--c-carbon) / .06), 0 8px 24px -12px rgb(var(--c-carbon) / .22)' },
    },
  },
  plugins: [],
} satisfies Config;
