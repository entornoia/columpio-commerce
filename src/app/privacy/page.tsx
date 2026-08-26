import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Política de privacidad | Columpio Commerce" };

export default function PrivacyPage() {
  return <LegalPage eyebrow="INFORMACIÓN LEGAL" title="Política de privacidad" intro="Esta política explica cómo Columpio Commerce trata la información necesaria para atender consultas comerciales recibidas por Instagram." sections={[
    { title: "Información que podemos procesar", paragraphs: [<>Cuando una persona conversa con Columpio Commerce por Instagram, podemos procesar el identificador necesario de su cuenta, los mensajes que envía y la información necesaria para mantener el contexto de esa conversación.</>, <>Las consultas sobre productos pueden relacionarse con información del catálogo de Columpio Mujer, incluyendo precios, variantes y stock disponibles.</>] },
    { title: "Cómo utilizamos la información", paragraphs: [<>Utilizamos esta información para comprender y responder consultas comerciales, ofrecer información de productos, preparar recomendaciones y, cuando corresponda, permitir que una persona continúe la atención.</>, <>Si se envía una imagen para analizar una prenda, la imagen se procesa con el fin de responder esa consulta. Columpio Commerce no la almacena permanentemente en sus propios sistemas.</>] },
    { title: "Servicios necesarios para operar", paragraphs: [<>Para prestar el servicio podemos utilizar proveedores tecnológicos, incluyendo Meta e Instagram para recibir y responder mensajes, Supabase para servicios de datos y seguridad, y OpenAI para procesar consultas y generar respuestas. Estos proveedores pueden tratar información conforme a sus propias condiciones y políticas.</>] },
    { title: "Venta de datos", paragraphs: [<>Columpio Commerce no vende datos personales.</>] },
    { title: "Seguridad", paragraphs: [<>Aplicamos medidas técnicas y organizativas razonables para proteger la información, incluyendo controles de acceso, autenticación administrativa, separación de credenciales del código y validación de las comunicaciones del webhook. Ningún sistema conectado a internet puede garantizar seguridad absoluta.</>] },
    { title: "Acceso, corrección y eliminación", paragraphs: [<>Puedes solicitar acceso, corrección o eliminación de información bajo control de Columpio Commerce escribiendo a <a href="mailto:costanerasupply@gmail.com">costanerasupply@gmail.com</a>. Para identificar la interacción, indica la cuenta de Instagram desde la cual te comunicaste. Podremos solicitar información adicional razonable para verificar la solicitud.</>] },
    { title: "Contacto", paragraphs: [<>Para consultas sobre privacidad, escribe a <a href="mailto:costanerasupply@gmail.com">costanerasupply@gmail.com</a>.</>] },
  ]} />;
}
