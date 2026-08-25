export function getInstagramConfig() {
  return {
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
    accessToken: process.env.META_INSTAGRAM_ACCESS_TOKEN ?? "",
    accountId: process.env.META_INSTAGRAM_ACCOUNT_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    graphVersion: process.env.META_GRAPH_API_VERSION ?? "",
  };
}

export function requireInstagramWebhookConfig() {
  const config = getInstagramConfig();
  if (!config.verifyToken || !config.appSecret) throw new Error("Falta configurar META_WEBHOOK_VERIFY_TOKEN o META_APP_SECRET.");
  return config;
}

export function requireInstagramSendConfig() {
  const config = getInstagramConfig();
  if (!config.accessToken || !config.accountId || !config.graphVersion) throw new Error("Falta configurar META_INSTAGRAM_ACCESS_TOKEN, META_INSTAGRAM_ACCOUNT_ID o META_GRAPH_API_VERSION.");
  return config;
}
