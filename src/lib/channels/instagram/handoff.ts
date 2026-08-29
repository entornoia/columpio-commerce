import type { IncomingConversationMetadata, InstagramConversationControl } from "./conversation-repository";
import { instagramOperationalLog } from "./logging.ts";

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
  pauseBeforeSend = () => false,
  persistPause,
}: {
  control: InstagramConversationControl;
  message: IncomingConversationMetadata;
  background?: () => Promise<void>;
  globalEnabled?: () => boolean;
  generate: () => Promise<T>;
  send: (value: T) => Promise<void>;
  pauseBeforeSend?: (value: T) => boolean;
  persistPause?: (value: T) => Promise<boolean | void>;
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

  if (pauseBeforeSend(value)) {
    instagramOperationalLog("handoff transition", { mode: "temporary_human", attempted: true });
    try {
      const transitioned = persistPause ? await persistPause(value) : (await control.pauseTemporarily(message.channel, message.externalUserId), true);
      if (transitioned === false) {
        instagramOperationalLog("handoff transition", { mode: "temporary_human", persisted: true, transitioned: false, automaticResponse: false });
        await finishBackground();
        return { status: "paused", reason: "temporary_human" };
      }
      const finalState = await control.getAutomationState(message.channel, message.externalUserId);
      if (finalState.agentEnabled || finalState.humanOnly) throw new Error("El estado final no corresponde a temporary_human");
      instagramOperationalLog("handoff transition", { mode: "temporary_human", persisted: true });
      instagramOperationalLog("final handoff state", { agentEnabled: finalState.agentEnabled, humanOnly: finalState.humanOnly, mode: "temporary_human" });
    } catch (error) {
      instagramOperationalLog("handoff transition", { mode: "temporary_human", persisted: false }, "error");
      await finishBackground();
      return { status: "handoff_error", error: error instanceof Error ? error.message : "Error activando handoff" };
    }
  }
  await send(value);
  await finishBackground();
  return { status: "sent", value };
}
