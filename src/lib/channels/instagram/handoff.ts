import type { IncomingConversationMetadata, InstagramAutomationState, InstagramConversationControl } from "./conversation-repository";

export type HandoffOutcome<T> =
  | { status: "sent"; value: T }
  | { status: "paused"; reason: "human_only" | "temporary_human" }
  | { status: "handoff_error"; error: string };

export async function runWithConversationHandoff<T>({
  control,
  message,
  background,
  generate,
  send,
}: {
  control: InstagramConversationControl;
  message: IncomingConversationMetadata;
  background?: () => Promise<void>;
  generate: () => Promise<T>;
  send: (value: T) => Promise<void>;
}): Promise<HandoffOutcome<T>> {
  const blockedReason = (state: InstagramAutomationState) => state.humanOnly ? "human_only" as const : !state.agentEnabled ? "temporary_human" as const : null;
  let backgroundTask: Promise<void> = Promise.resolve();
  const finishBackground = async () => { await backgroundTask; };
  try {
    await control.registerIncoming(message);
    if (background) backgroundTask = Promise.resolve().then(background).catch(() => undefined);
    const reason = blockedReason(await control.getAutomationState(message.channel, message.externalUserId));
    if (reason) { await finishBackground(); return { status: "paused", reason }; }
  } catch (error) {
    await finishBackground();
    return { status: "handoff_error", error: error instanceof Error ? error.message : "Error consultando handoff" };
  }

  const value = await generate();

  try {
    const reason = blockedReason(await control.getAutomationState(message.channel, message.externalUserId));
    if (reason) { await finishBackground(); return { status: "paused", reason }; }
  } catch (error) {
    await finishBackground();
    return { status: "handoff_error", error: error instanceof Error ? error.message : "Error consultando handoff" };
  }

  await send(value);
  await finishBackground();
  return { status: "sent", value };
}
