import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstagramConfig } from "./config";
import { instagramDevLog } from "./logging";
import { refreshInstagramUsername, type InstagramProfileRepository } from "./profile-refresh";

function maskedId(id: string) { return id.length > 6 ? `${id.slice(0, 3)}…${id.slice(-3)}` : "***"; }

export function createInstagramProfileRepository(supabase: SupabaseClient): InstagramProfileRepository {
  return {
    async get(externalUserId) {
      const { data, error } = await supabase.from("instagram_conversations").select("instagram_username, profile_checked_at")
        .eq("channel", "instagram").eq("external_user_id", externalUserId).single();
      if (error || !data) throw new Error(`No se pudo consultar el perfil de Instagram: ${error?.message ?? "conversación inexistente"}`);
      return { username: typeof data.instagram_username === "string" ? data.instagram_username : null, profileCheckedAt: typeof data.profile_checked_at === "string" ? data.profile_checked_at : null };
    },
    async saveUsername(externalUserId, username, checkedAt) {
      const { error } = await supabase.from("instagram_conversations").update({ instagram_username: username, profile_checked_at: checkedAt })
        .eq("channel", "instagram").eq("external_user_id", externalUserId);
      if (error) throw new Error(`No se pudo guardar el username de Instagram: ${error.message}`);
    },
    async markChecked(externalUserId, checkedAt) {
      const { error } = await supabase.from("instagram_conversations").update({ profile_checked_at: checkedAt })
        .eq("channel", "instagram").eq("external_user_id", externalUserId);
      if (error) throw new Error(`No se pudo actualizar profile_checked_at: ${error.message}`);
    },
  };
}

export async function fetchInstagramUsername(externalUserId: string, fetchImpl: typeof fetch = fetch) {
  const config = getInstagramConfig();
  if (!config.accessToken || !config.graphVersion) throw new Error("Falta configurar el acceso server-side a Instagram.");
  const url = new URL(`https://graph.instagram.com/${encodeURIComponent(config.graphVersion)}/${encodeURIComponent(externalUserId)}`);
  url.searchParams.set("fields", "username");
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.accessToken}` }, signal: AbortSignal.timeout(5_000) });
  const body = await response.json().catch(() => ({})) as { username?: unknown; error?: { code?: unknown; type?: unknown } };
  if (!response.ok || typeof body.username !== "string" || !body.username.trim()) {
    const error = new Error(`Instagram Profile API rechazó la consulta (${response.status}).`) as Error & { status?: number; code?: unknown; type?: unknown };
    error.status = response.status; error.code = body.error?.code; error.type = body.error?.type;
    throw error;
  }
  return body.username.trim().slice(0, 64);
}

export async function refreshInstagramProfile(supabase: SupabaseClient, externalUserId: string) {
  try {
    const result = await refreshInstagramUsername({ repository: createInstagramProfileRepository(supabase), externalUserId, fetchUsername: fetchInstagramUsername });
    if (result.status === "updated") instagramDevLog("profile refreshed", { sender: maskedId(externalUserId), usernamePresent: true });
    if (result.status === "failed") {
      const safe = result.error as Error & { status?: number; code?: unknown; type?: unknown };
      instagramDevLog("profile refresh failed", { sender: maskedId(externalUserId), status: safe.status, code: safe.code, type: safe.type, checkedAtPersisted: result.checkedAtPersisted }, "error");
    }
  } catch {
    instagramDevLog("profile refresh failed", { sender: maskedId(externalUserId), stage: "repository" }, "error");
  }
}
