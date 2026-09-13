import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/storefront/cart-server";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { createServiceClient } from "@/lib/supabase/service";

type StorageEntry = { imageId: string; bucket: string; path: string };

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function storageEntries(value: unknown, productId: string): StorageEntry[] {
  if (!Array.isArray(value)) throw new Error("El manifiesto de imágenes no es válido.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("El manifiesto de imágenes no es válido.");
    const row = entry as Record<string, unknown>;
    const imageId = String(row.imageId ?? "");
    const bucket = String(row.bucket ?? "");
    const path = String(row.path ?? "");
    if (!validUuid(imageId) || bucket !== "product-images" || !new RegExp(`^${productId}/${imageId}\\.(?:jpg|jpeg|png|webp)$`, "i").test(path)) {
      throw new Error("El manifiesto de imágenes no es válido.");
    }
    return { imageId, bucket, path };
  });
}

async function authorizedProductId(params: Promise<{ id: string }>) {
  const { authorized, user } = await getAdministrativeSession();
  if (!authorized || !user) return null;
  const { id } = await params;
  if (!validUuid(id)) return null;
  return { id, user };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authorizedProductId(params);
  if (!identity) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data, error } = await createServiceClient().rpc("get_technical_draft_deletion_eligibility", { p_product_id: identity.id });
  if (error) return NextResponse.json({ error: "No se pudo verificar este borrador." }, { status: 500 });
  return NextResponse.json({ eligibility: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await authorizedProductId(params);
    if (!identity) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const service = createServiceClient();
    const { data: preparedData, error: prepareError } = await service.rpc("begin_technical_draft_deletion", {
      p_product_id: identity.id,
      p_actor_user_id: identity.user.id,
    });
    if (prepareError) return NextResponse.json({ error: "Este producto ya no cumple las condiciones para eliminarse." }, { status: 409 });

    const prepared = preparedData as Record<string, unknown>;
    if (prepared.status === "completed") return NextResponse.json({ deleted: true, idempotent: true });
    const operationId = String(prepared.operationId ?? "");
    if (!validUuid(operationId)) throw new Error("La operación de borrado no es válida.");
    const images = storageEntries(prepared.storage, identity.id);

    if (images.length) {
      const { error: storageError } = await service.storage.from("product-images").remove(images.map((image) => image.path));
      if (storageError) {
        await service.rpc("fail_technical_draft_storage_deletion", { p_product_id: identity.id, p_operation_id: operationId });
        return NextResponse.json({ error: "No se pudieron retirar las imágenes. El producto no fue eliminado." }, { status: 502 });
      }
    }

    const { data: finalized, error: finalizeError } = await service.rpc("finalize_technical_draft_deletion", {
      p_product_id: identity.id,
      p_operation_id: operationId,
    });
    if (finalizeError) return NextResponse.json({ error: "El borrador cambió durante la operación y no fue eliminado." }, { status: 409 });
    return NextResponse.json(finalized);
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Origen no permitido.";
    return NextResponse.json({ error: unauthorized ? "No autorizado." : "No se pudo eliminar el borrador." }, { status: unauthorized ? 403 : 500 });
  }
}
