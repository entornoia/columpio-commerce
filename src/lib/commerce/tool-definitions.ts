const emptyParameters = { type: "object", additionalProperties: false, properties: {}, required: [] } as const;
const variantId = { type: "string", description: "UUID exacto de una variante devuelta por search_catalog." } as const;
const quantity = { type: "integer", minimum: 1, maximum: 20, description: "Cantidad solicitada para esa variante, entre 1 y 20." } as const;

export const commerceToolDefinitions = [
  { type: "function" as const, name: "add_to_cart", description: "Agrega una cantidad de una variante real al carrito abierto. Requiere una variante inequívoca.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { variantId, quantity }, required: ["variantId", "quantity"] } },
  { type: "function" as const, name: "view_cart", description: "Consulta el carrito persistente actual con sus importes y variantes reales.", strict: true, parameters: emptyParameters },
  { type: "function" as const, name: "remove_from_cart", description: "Elimina por completo una variante del carrito abierto.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { variantId }, required: ["variantId"] } },
  { type: "function" as const, name: "set_cart_quantity", description: "Establece la cantidad total de una variante ya elegida en el carrito.", strict: true, parameters: { type: "object", additionalProperties: false, properties: { variantId, quantity }, required: ["variantId", "quantity"] } },
  { type: "function" as const, name: "create_order", description: "Convierte el carrito abierto en un pedido pendiente de pago, solo tras confirmación explícita en el mensaje actual.", strict: true, parameters: emptyParameters },
] as const;
