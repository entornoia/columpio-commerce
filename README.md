# Columpio Commerce

Herramienta administrativa interna para el catálogo y stock de **Columpio Mujer**. Este repositorio contiene exclusivamente el Bloque 1A.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

La aplicación funciona inicialmente con datos de demostración persistidos en `localStorage`, de modo que altas y ediciones pueden probarse sin servicios externos.

## Supabase

1. Crea un proyecto nuevo y exclusivo para Columpio Commerce.
2. Ejecuta `supabase/migrations/001_catalog.sql` en el SQL Editor.
3. Opcionalmente ejecuta `supabase/seed.sql` para cargar datos de ejemplo.
4. Copia `.env.example` a `.env.local` y completa las credenciales del proyecto.

La conexión remota se integrará cuando exista el proyecto Supabase. El esquema ya define relaciones, SKU únicos y stock no negativo.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
