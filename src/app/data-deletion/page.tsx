import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Eliminación de datos | Columpio Commerce" };

export default function DataDeletionPage() {
  return <LegalPage eyebrow="PRIVACIDAD" title="Solicitud de eliminación de datos" intro="Puedes solicitar la eliminación de los datos asociados a tu interacción con Columpio Commerce siguiendo estas instrucciones." sections={[
    { title: "Cómo enviar una solicitud", paragraphs: [<>Envía un correo a <a href="mailto:costanerasupply@gmail.com">costanerasupply@gmail.com</a> con el asunto “Solicitud de eliminación de datos”.</>, <>En el mensaje, identifica la cuenta de Instagram desde la cual interactuaste con el servicio. No envíes tu contraseña, token de acceso ni otras credenciales. Podremos solicitar información adicional razonable únicamente para verificar que la solicitud corresponde a la persona indicada.</>] },
    { title: "Qué ocurrirá con la solicitud", paragraphs: [<>Revisaremos la solicitud y eliminaremos los datos bajo control de Columpio Commerce que correspondan a la interacción identificada. Informaremos la resolución o cualquier antecedente adicional necesario mediante el correo utilizado para contactarnos.</>] },
    { title: "Conservación exigida", paragraphs: [<>Determinada información podría conservarse cuando una obligación legal aplicable así lo exija o permita. En ese caso, su uso quedará limitado al cumplimiento de esa obligación.</>] },
    { title: "Servicios de terceros", paragraphs: [<>Esta solicitud cubre los datos bajo control de Columpio Commerce. Para información gestionada directamente por Instagram u otros servicios de terceros, pueden aplicar sus propios mecanismos y políticas de eliminación.</>] },
  ]} />;
}
