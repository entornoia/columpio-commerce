import OpenAI from "openai";
import { NextResponse } from "next/server";
import { analyzeCatalogProductImage, validatedCatalogImageFromBytes } from "@/lib/catalog-product-analysis";
import { estimateTokenCostUsd } from "@/lib/agent/cost";
import { createClient } from "@/lib/supabase/server";

type RequestBody = { productId?: unknown; imageId?: unknown };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const [{ data: userData, error: userError }, { data: claimsData }] = await Promise.all([
    supabase.auth.getUser(), supabase.auth.getClaims(),
  ]);
  if (userError || !userData.user || claimsData?.claims?.role !== "authenticated") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Falta configurar OPENAI_API_KEY." }, { status: 503 });

  let body: RequestBody;
  try { body = await request.json() as RequestBody; }
  catch { return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (typeof body.productId !== "string" || typeof body.imageId !== "string"
    || !UUID_PATTERN.test(body.productId) || !UUID_PATTERN.test(body.imageId)) {
    return NextResponse.json({ error: "Producto e imagen son obligatorios." }, { status: 400 });
  }

  const [productResult, imageResult] = await Promise.all([
    supabase.from("products").select("id, brand_id, setup_status, publication_status, active").eq("id", body.productId).maybeSingle(),
    supabase.from("product_images").select("id, product_id, storage_bucket, storage_path, mime_type, file_size, status").eq("id", body.imageId).maybeSingle(),
  ]);
  const product = productResult.data;
  const image = imageResult.data;
  const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);
  const expectedExtension = image?.mime_type === "image/jpeg" ? "(?:jpg|jpeg)" : image?.mime_type === "image/png" ? "png" : image?.mime_type === "image/webp" ? "webp" : "invalid";
  const hasExactPath = Boolean(product && image?.storage_path && new RegExp(`^${product.id}/${image.id}\\.${expectedExtension}$`).test(image.storage_path));
  if (productResult.error || imageResult.error || !product || !image
    || image.product_id !== product.id || image.status !== "ready"
    || image.storage_bucket !== "product-images" || !image.storage_path
    || !hasExactPath
    || !image.mime_type || !allowedMime.has(image.mime_type)
    || !image.file_size || image.file_size > 5 * 1024 * 1024
    || !(["technical_draft", "in_progress"] as string[]).includes(product.setup_status)
    || product.publication_status !== "draft" || product.active) {
    return NextResponse.json({ error: "El draft o la imagen no están disponibles para análisis." }, { status: 422 });
  }

  const { data: blob, error: downloadError } = await supabase.storage.from("product-images").download(image.storage_path);
  if (downloadError || !blob) return NextResponse.json({ error: "No se pudo leer la imagen almacenada." }, { status: 422 });
  let validatedImage;
  try {
    validatedImage = validatedCatalogImageFromBytes(new Uint8Array(await blob.arrayBuffer()), image.mime_type);
    if (validatedImage.size !== image.file_size) throw new Error("size_mismatch");
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "La imagen no es válida." }, { status: 422 }); }

  const { error: beginError } = await supabase.rpc("begin_product_intake_analysis", { p_product_id: product.id, p_image_id: image.id });
  if (beginError) return NextResponse.json({ error: "El análisis ya está en curso o el draft no admite un nuevo intento." }, { status: 409 });

  try {
    const analyzed = await analyzeCatalogProductImage(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), validatedImage);
    const categorySlug = analyzed.analysis.normalizedCategorySlug.value;
    const categoryResult = categorySlug
      ? await supabase.from("categories").select("id, slug, name").eq("brand_id", product.brand_id).eq("slug", categorySlug).eq("active", true).maybeSingle()
      : { data: null, error: null };
    if (categoryResult.error || (categorySlug && !categoryResult.data)) throw new Error("invalid_category");
    const { error: completeError } = await supabase.rpc("complete_product_intake_analysis", { p_product_id: product.id, p_model: analyzed.model });
    if (completeError) throw new Error("complete_failed");
    const usage = {
      inputTokens: analyzed.usage?.input_tokens ?? 0,
      outputTokens: analyzed.usage?.output_tokens ?? 0,
      totalTokens: analyzed.usage?.total_tokens ?? 0,
    };
    return NextResponse.json({
      analysis: analyzed.analysis,
      resolvedCategory: categoryResult.data ? { id: categoryResult.data.id, slug: categoryResult.data.slug, name: categoryResult.data.name } : null,
      suggestedSlug: slugify(analyzed.analysis.commercialName.value ?? ""),
      model: analyzed.model,
      usage,
      estimatedCostUsd: estimateTokenCostUsd(analyzed.model, usage),
    });
  } catch {
    const safeMessage = "No se pudo analizar la prenda. Puedes reintentar cuando quieras.";
    await supabase.rpc("fail_product_intake_analysis", { p_product_id: product.id, p_error: safeMessage });
    return NextResponse.json({ error: safeMessage }, { status: 502 });
  }
}
