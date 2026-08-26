# Instagram Direct Messages — configuración manual

Esta integración usa **Instagram API with Instagram Login**. No necesita una Facebook Page para este flujo; la cuenta sí debe ser profesional (Business o Creator). No desplegar ni publicar la app hasta revisar nuevamente la versión vigente de Graph API en Meta.

## Variables server-side

Copiar solo en `.env.local` o en los secretos del hosting:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=
META_WEBHOOK_VERIFY_TOKEN=
META_INSTAGRAM_ACCESS_TOKEN=
META_INSTAGRAM_ACCOUNT_ID=
META_APP_SECRET=
META_GRAPH_API_VERSION=v25.0
```

- `SUPABASE_SERVICE_ROLE_KEY`: Settings → API Keys en Supabase. Es necesaria porque el webhook no tiene la cookie del administrador y debe leer el catálogo desde backend. Nunca usarla en código cliente.
- `META_WEBHOOK_VERIFY_TOKEN`: texto aleatorio largo creado por nosotros; debe coincidir en Meta y el servidor.
- `META_APP_SECRET`: **Instagram → API setup with Instagram login**, bloque que muestra `Instagram App ID` y `Instagram App Secret`; pulsar **Show** junto a `Instagram App Secret`. Para este flujo no usar el secreto principal de **App settings → Basic**. El servidor lo usa para HMAC y no es el verify token.
- `META_INSTAGRAM_ACCESS_TOKEN`: token de la cuenta profesional con los permisos indicados abajo.
- `META_INSTAGRAM_ACCOUNT_ID`: ID numérico de la cuenta profesional (`IG_ID`), no el username ni el IGSID de una clienta.
- `META_GRAPH_API_VERSION`: versión vigente elegida en Meta. El ejemplo se preparó para `v25.0`; confirmarla antes de conectar producción.

Reiniciar `pnpm dev` después de cambiar `.env.local`.

## Meta App Dashboard

1. En Meta for Developers, crear una app de tipo **Business** y asociarla al portafolio comercial de Columpio.
2. En los casos de uso/productos, agregar **Instagram API** y elegir **Instagram API with Instagram Login**.
3. Vincular la cuenta profesional de Instagram de Columpio. Para este flujo nuevo no se exige una Facebook Page; si se elige deliberadamente el flujo antiguo “Instagram API with Facebook Login”, la Page y los permisos son diferentes y este documento no aplica.
4. En Instagram → API setup / Business Login, agregar la cuenta como tester mientras la app permanezca en Development. La cuenta debe aceptar la invitación desde Instagram.
5. Solicitar/autorizar exactamente `instagram_business_basic` y `instagram_business_manage_messages`. Para una sola cuenta propia en desarrollo pueden usarse roles/testers; para usuarias/cuentas fuera de roles, completar App Review y Business Verification cuando Meta lo solicite.
6. Generar el access token para la cuenta profesional, obtener su `IG_ID` y guardarlos únicamente en las variables anteriores. Antes de producción, usar el mecanismo de token duradero que ofrezca el panel y documentar su renovación.
7. Exponer temporalmente `http://localhost:3000` mediante un túnel HTTPS con URL estable, o usar una URL HTTPS de preview autorizada. No se puede registrar una callback localhost directamente en Meta.
8. En Webhooks de Instagram configurar:
   - Callback URL: `https://TU-HOST/api/webhooks/instagram`
   - Verify token: el valor exacto de `META_WEBHOOK_VERIFY_TOKEN`
   - Campo mínimo: `messages`
   - Campo opcional futuro: `messaging_postbacks` (el parser actual ignora postbacks comerciales no implementados).
9. Suscribir la app a los webhooks de la cuenta profesional desde Instagram API setup. Enviar un evento de prueba y confirmar HTTP 200.
10. Desde una segunda cuenta de Instagram, iniciar el DM a Columpio y probar primero texto. La Send API solo responde a una persona que inició la conversación; las respuestas normales deben ocurrir dentro de la ventana de 24 horas.

## Seguridad y operación

- GET devuelve `hub.challenge` solo si `hub.mode=subscribe` y el verify token coincide; si no, responde 403.
- POST calcula HMAC SHA-256 sobre el cuerpo JSON crudo con `META_APP_SECRET` y compara el header `X-Hub-Signature-256` (`sha256=<hex>`). Firma ausente o inválida responde 401 antes de parsear/procesar.
- Los ecos (`message.is_echo`, `message.is_self`) y eventos cuyo sender sea la propia cuenta se ignoran.
- El envío usa `POST https://graph.instagram.com/{version}/{IG_ID}/messages`, Bearer token y el IGSID recibido como `recipient.id`.
- No se implementan mensajes salientes, campañas ni evasión de la ventana de mensajería. El límite de frecuencia de Meta se reporta como error temporal sin registrar tokens.
- Las URLs de imagen se aceptan solo por HTTPS desde hosts `*.fbcdn.net` o `*.fbsbx.com`, sin redirecciones, con límite de 5 MB y validación del contenido.

## Prueba local

Abrir `/instagram-test` con la sesión administrativa. El endpoint `/api/channels/instagram/test` reutiliza parser, contexto, agente y Supabase reales, pero captura la salida en pantalla en lugar de enviarla a Meta. Está disponible solo en desarrollo. Los eventos recientes son memoria efímera y no constituyen un inbox.

Fuentes vigentes consultadas: colección oficial de Meta para [Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [payloads de Webhooks](https://www.postman.com/meta/instagram/folder/23987686-5049585f-09b2-4775-a11a-debe5956e09a) y [Webhooks de Messenger Platform](https://www.postman.com/meta/messenger-platform-api/folder/22794852-b5d97624-14d8-4e67-a2e4-529add49ca58).
