import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/storefront/cart-server";
import { isPostgresUuid, isProductImageStoragePath } from "@/lib/postgres-uuid";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { createServiceClient } from "@/lib/supabase/service";

type StorageEntry = { imageId: string; bucket: string; path: string };
type LifecycleAction = "deactivate" | "reactivate";

function storageEntries(value: unknown, productId: string): StorageEntry[] {
  if (!Array.isArray(value)) throw new Error("El manifiesto de imágenes no es válido.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("El manifiesto de imágenes no es válido.");
    const row = entry as Record<string, unknown>;
    const imageId = String(row.imageId ?? "");
    const bucket = String(row.bucket ?? "");
    const path = String(row.path ?? "");
    if (bucket !== "product-images" || !isProductImageStoragePath(path, productId, imageId)) {
      throw new Error("El manifiesto de imágenes no es válido.");
    }
    return { imageId, bucket, path };
  });
}

async function authorizedProduct(params: Promise<{ id: string }>) {
  const { authorized, user } = await getAdministrativeSession();
  if (!authorized || !user) return null;
  const { id } = await params;
  if (!isPostgresUuid(id)) return null;
  return { id, user };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authorizedProduct(params);
  if (!identity) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data, error } = await createServiceClient().rpc("get_product_management_eligibility", { p_product_id: identity.id });
  if (error) return NextResponse.json({ error: "No se pudo verificar la gestión de este producto." }, { status: 500 });
  return NextResponse.json({ management: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await authorizedProduct(params);
    if (!identity) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const body = await request.json().catch(() => null) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== "deactivate" && action !== "reactivate") {
      return NextResponse.json({ error: "Acción no permitida." }, { status: 400 });
    }
    const rpc = action === "deactivate" ? "deactivate_catalog_product" : "reactivate_catalog_product";
    const { data, error } = await createServiceClient().rpc(rpc, {
      p_product_id: identity.id,
      p_actor_user_id: identity.user.id,
    });
    if (error) return NextResponse.json({ error: lifecycleError(action) }, { status: 409 });
    return NextResponse.json({ result: data });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Origen no permitido.";
    return NextResponse.json({ error: unauthorized ? "No autorizado." : "No se pudo actualizar el estado del producto." }, { status: unauthorized ? 403 : 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const identity = await authorizedProduct(params);
    if (!identity) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const service = createServiceClient();
    const { data: preparedData, error: prepareError } = await service.rpc("begin_safe_product_deletion", {
      p_product_id: identity.id,
      p_actor_user_id: identity.user.id,
    });
    if (prepareError) return NextResponse.json({ error: "Este producto ya no cumple las condiciones para eliminarse." }, { status: 409 });

    const prepared = preparedData as Record<string, unknown>;
    if (prepared.status === "completed") return NextResponse.json({ deleted: true, idempotent: true });
    const operationId = String(prepared.operationId ?? "");
    if (!isPostgresUuid(operationId)) throw new Error("La operación de borrado no es válida.");
    const images = storageEntries(prepared.storage, identity.id);

    if (images.length) {
      const { error: storageError } = await service.storage.from("product-images").remove(images.map((image) => image.path));
      if (storageError) {
        await service.rpc("fail_safe_product_storage_deletion", { p_product_id: identity.id, p_operation_id: operationId });
        return NextResponse.json({ error: "No se pudieron retirar las imágenes. El producto no fue eliminado." }, { status: 502 });
      }
    }

    const { data: finalized, error: finalizeError } = await service.rpc("finalize_safe_product_deletion", {
      p_product_id: identity.id,
      p_operation_id: operationId,
    });
    if (finalizeError) return NextResponse.json({ error: "El producto cambió durante la operación y no fue eliminado." }, { status: 409 });
    const result = finalized as { deleted?: boolean } | null;
    if (!result?.deleted) return NextResponse.json({ error: "Apareció una referencia nueva. El producto se conservó." }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Origen no permitido.";
    return NextResponse.json({ error: unauthorized ? "No autorizado." : "No se pudo eliminar el producto." }, { status: unauthorized ? 403 : 500 });
  }
}

function lifecycleError(action: LifecycleAction) {
  return action === "deactivate"
    ? "El producto cambió y no pudo desactivarse. Actualiza la página e intenta nuevamente."
    : "El producto debe estar completo y sin operaciones pendientes antes de reactivarse.";
}
