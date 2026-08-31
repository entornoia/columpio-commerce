# Deuda técnica

## Identidad estable de variantes

La edición administrativa actual reemplaza variantes mediante `DELETE` + `INSERT`. Esa estrategia deja de ser válida cuando una variante tiene referencias históricas en `commerce_cart_items`, pedidos web u otras tablas comerciales.

Un bloque posterior de administración debe migrar el guardado a operaciones estables por `product_variants.id`: actualizar filas existentes, insertar solamente variantes nuevas y desactivar —no borrar— variantes con historia comercial. El UUID de una variante utilizada comercialmente debe conservarse permanentemente.
