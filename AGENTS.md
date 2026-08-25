# Columpio Commerce — reglas del repositorio

1. Este repositorio corresponde exclusivamente a **Columpio Commerce**, marca comercial **Columpio Mujer**.
2. Ninguna tarea realizada aquí debe leer, modificar o ejecutar código de repositorios externos.
3. `CoreKloset.App` es un proyecto completamente independiente y nunca debe reutilizarse desde este repositorio.
4. El desarrollo se realiza incrementalmente por bloques aprobados.
5. No se implementará funcionalidad de bloques futuros sin instrucción explícita.
6. Antes de modificaciones grandes se debe revisar `git status` y confirmar la raíz del repositorio.
7. Después de cada bloque estable se deben ejecutar lint, comprobación de tipos, pruebas pertinentes y build.
8. Los datos objetivos de productos —precio, stock, código y variantes— deben provenir siempre de la base de datos y nunca ser inventados por un modelo de IA.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
