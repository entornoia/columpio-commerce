import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Condiciones de uso | Columpio Commerce" };

export default function TermsPage() {
  return <LegalPage eyebrow="INFORMACIÓN LEGAL" title="Condiciones de uso" intro="Estas condiciones regulan el uso del asistente de Columpio Commerce para consultas comerciales relacionadas con Columpio Mujer." sections={[
    { title: "Finalidad del servicio", paragraphs: [<>El asistente permite realizar consultas comerciales, buscar productos y recibir recomendaciones generales de estilo a través de los canales habilitados, incluyendo Instagram.</>] },
    { title: "Productos, precios y disponibilidad", paragraphs: [<>La información de precios, variantes y stock está sujeta a disponibilidad y puede cambiar. Una respuesta del asistente no constituye una reserva, confirmación de compra ni garantía de que un producto continúe disponible al momento de completar una compra.</>] },
    { title: "Recomendaciones", paragraphs: [<>Las recomendaciones de estilo son orientativas y dependen de la información proporcionada. No garantizan un resultado específico, ajuste, preferencia personal ni satisfacción con una compra.</>] },
    { title: "Atención humana", paragraphs: [<>El asistente puede derivar una conversación a una persona cuando la consulta requiera revisión, información adicional o atención que no pueda proporcionar de forma segura.</>] },
    { title: "Uso responsable", paragraphs: [<>Debes utilizar el servicio de manera lícita y respetuosa, sin intentar interferir con su funcionamiento, acceder a información ajena, enviar contenido malicioso o utilizarlo para fines abusivos o fraudulentos.</>, <>El servicio utiliza automatización e inteligencia artificial como apoyo a la atención comercial. Sus respuestas no sustituyen la confirmación final de una persona ni constituyen garantía de compra, disponibilidad o resultado.</>] },
    { title: "Contacto", paragraphs: [<>Si tienes preguntas sobre estas condiciones, escribe a <a href="mailto:costanerasupply@gmail.com">costanerasupply@gmail.com</a>.</>] },
  ]} />;
}
