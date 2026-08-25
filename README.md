# Columpio Commerce

Herramienta administrativa interna para el catálogo y stock de **Columpio Mujer**. Este repositorio contiene exclusivamente el Bloque 1A.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Supabase es la fuente única de verdad. La aplicación no usa `localStorage`, datos demo ni fallback silencioso para el catálogo.

## Supabase

1. Crea un proyecto nuevo y exclusivo para Columpio Commerce.
2. Ejecuta `supabase/migrations/001_catalog.sql` y `supabase/migrations/002_auth_rls_and_catalog_rpc.sql` en el SQL Editor, en ese orden.
3. Opcionalmente ejecuta `supabase/seed.sql` para cargar datos de ejemplo.
4. Copia `.env.example` a `.env.local` y completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` desde **Project Settings → API**.
5. En **Authentication → Users**, crea manualmente el único usuario administrador con correo y contraseña. No habilites registro público en la aplicación.

La migración 002 habilita RLS, revoca todos los privilegios de `anon` y concede CRUD únicamente a `authenticated`. La función `save_catalog_product` usa `security invoker`, por lo que respeta esas mismas políticas y guarda producto, variantes e imágenes en una sola transacción.

## Búsqueda estructurada

La ruta autenticada `/catalog-search` permite probar filtros determinísticos sobre el catálogo real. La función reusable `searchCatalog(client, filters)` vive en `src/lib/catalog-search.ts`, separada de React, y devuelve únicamente variantes compatibles y su stock total. Puede reutilizarse desde una API route, Server Action o herramienta futura sin incorporar IA.

## Agente vendedor interno

La ruta protegida `/agent-test` usa Responses API y la herramienta segura `search_catalog`. La clave `OPENAI_API_KEY` es privada y solo se lee en el servidor. El modelo se cambia en `src/lib/agent/config.ts`; el MVP usa `gpt-5.4-mini`. El historial es corto y vive únicamente en memoria del navegador.

El análisis visual del BLOQUE 2B acepta una sola imagen JPEG, PNG o WebP de hasta 5 MB. La imagen se valida y se envía al modelo desde el backend únicamente durante esa solicitud: no se almacena en Supabase ni en otro servicio del proyecto. La conversación conserva en memoria solo los atributos estructurados y los elimina al iniciar una conversación nueva.

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
