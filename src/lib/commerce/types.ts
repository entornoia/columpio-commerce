import type { SupabaseClient } from "@supabase/supabase-js";
import type { FlowGateway } from "../payments/flow";

export type CommerceToolName = "add_to_cart" | "view_cart" | "remove_from_cart" | "set_cart_quantity" | "create_order" | "create_payment_link";

export type InstagramCommerceContext = {
  supabase: SupabaseClient;
  externalUserId: string;
  eventId: string;
  authorizeMutation: () => Promise<void>;
  flowGateway?: FlowGateway;
};

export type CommerceToolResult = Record<string, unknown> & { status: string };
