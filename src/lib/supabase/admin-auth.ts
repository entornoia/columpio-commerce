import { createClient } from "./server";
import { isAdministrativeIdentity } from "./admin-identity";

export async function getAdministrativeSession() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const authorized = !userError && !claimsError && isAdministrativeIdentity(userData.user, claimsData?.claims?.role);
  return { authorized, user: userData.user ?? null };
}
