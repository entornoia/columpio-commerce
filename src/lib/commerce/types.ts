import type { SupabaseClient } from "@supabase/supabase-js";

export type CommerceToolName = "add_to_cart" | "view_cart" | "remove_from_cart" | "set_cart_quantity" | "create_order";

export type InstagramCommerceContext = {
  supabase: SupabaseClient;
  externalUserId: string;
  eventId: string;
  authorizeMutation: () => Promise<void>;
};

export type CommerceToolResult = Record<string, unknown> & { status: string };
