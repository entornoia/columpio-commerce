import type { IncomingConversationMetadata, InstagramConversationControl } from "./conversation-repository";

export function isInstagramAgentGloballyEnabled() {
  return process.env.INSTAGRAM_AGENT_ENABLED === "true";
}

export async function getInstagramAutomationBlockReason(
  control: InstagramConversationControl,
  externalUserId: string,
  globalEnabled: () => boolean = isInstagramAgentGloballyEnabled,
) {
  if (!globalEnabled()) return "global_disabled" as const;
  const state = await control.getAutomationState("instagram", externalUserId);
  return state.humanOnly ? "human_only" as const : !state.agentEnabled ? "temporary_human" as const : null;
}

export type HandoffOutcome<T> =
  | { status: "sent"; value: T }
  | { status: "paused"; reason: "global_disabled" | "human_only" | "temporary_human" }
  | { status: "handoff_error"; error: string };

export async function runWithConversationHandoff<T>({
  control,
  message,
  background,
  globalEnabled = isInstagramAgentGloballyEnabled,
  generate,
  send,
}: {
  control: InstagramConversationControl;
  message: IncomingConversationMetadata;
  background?: () => Promise<void>;
  globalEnabled?: () => boolean;
  generate: () => Promise<T>;
  send: (value: T) => Promise<void>;
}): Promise<HandoffOutcome<T>> {
  let backgroundTask: Promise<void> = Promise.resolve();
  const finishBackground = async () => { await backgroundTask; };
  try {
    await control.registerIncoming(message);
    if (background) backgroundTask = Promise.resolve().then(background).catch(() => undefined);
    const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, globalEnabled);
    if (reason) { await finishBackground(); return { status: "paused", reason }; }
  } catch (error) {
    await finishBackground();
    return { status: "handoff_error", error: error instanceof Error ? error.message : "Error consultando handoff" };
  }

  const value = await generate();

  try {
    const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, globalEnabled);
    if (reason) { await finishBackground(); return { status: "paused", reason }; }
  } catch (error) {
    await finishBackground();
    return { status: "handoff_error", error: error instanceof Error ? error.message : "Error consultando handoff" };
  }

  await send(value);
  await finishBackground();
  return { status: "sent", value };
}
