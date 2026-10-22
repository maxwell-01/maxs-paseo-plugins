import { once } from "node:events";
import { join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import type { bridgeSettings } from "../shared/settings.shared";
import { createIgnoredSenderLog, isAllowed } from "./allow-list.server";
import { createChatTurns } from "./chat-turns.server";
import { describeError } from "./describe-error.server";
import { fetchAttachments } from "./attachments.server";
import { hasContentForAgent, isUnsupportedContent, paseoMessageId, promptFor, UNSUPPORTED_REPLY } from "./inbound.server";
import { createOffsetStore } from "./offset-store.server";
import { replyFor } from "./outbound.server";
import { createPendingReplies } from "./pending-replies.server";
import { planReply } from "./send-files.server";
import { sendReply } from "./send-reply.server";
import { runPoller } from "./poller.server";
import { createTelegramApi, redactToken, type TelegramApi, type TelegramMessage } from "./telegram-api.server";

type Settings = PluginSettings<typeof bridgeSettings.schema>;
type SettingsState = PluginSettingsState<typeof bridgeSettings.schema>;
type AgentHandle = ReturnType<PluginHookContext["paseo"]["agents"]["ref"]>;
type TurnEnded = Pick<PluginLifecycleEvents["agent.turn_ended"], "agent" | "outcome" | "timeline">;

export interface AgentMessenger {
  agents: { ref(agentId: string): Pick<AgentHandle, "send"> };
}

interface BridgeOptions {
  settings: Settings;
  paseo: Promise<AgentMessenger>;
  dataDir: string;
  home: string;
  paseoHome: string;
  apiUrl: string;
  log(line: string): void;
}

const stopped = async () => {};

export function startBridge({ settings, paseo, dataDir, home, paseoHome, apiUrl, log }: BridgeOptions) {
  const offsets = createOffsetStore(join(dataDir, "state.json"));
  const filesDir = join(dataDir, "files");
  const sendPolicy = { home, paseoHome, bridgeFilesDir: filesDir };
  const pending = createPendingReplies();
  let live: { api: TelegramApi; agentId: string; log(line: string): void; turnEnded(): Promise<void> } | null = null;

  function run(state: SettingsState): () => Promise<void> {
    if (state.status !== "ready") {
      log(`telegram-bridge: the settings are invalid, so the bridge is off: ${state.error}`);
      return stopped;
    }
    const { values } = state;
    const { botToken, agentId } = values;
    if (!botToken || !agentId) {
      log("telegram-bridge: set a bot token and an agent id to turn the bridge on");
      return stopped;
    }
    const api = createTelegramApi({ token: botToken, baseUrl: apiUrl });
    const redactedLog = (line: string) => log(redactToken(line, botToken));
    const logIgnored = createIgnoredSenderLog(redactedLog);
    const controller = new AbortController();
    const turns = createChatTurns();

    async function deliver(messenger: AgentMessenger, message: TelegramMessage) {
      if (!isAllowed(message, values)) return logIgnored(message);
      if (!hasContentForAgent(message)) {
        return isUnsupportedContent(message) ? api.sendMessage(message.chat.id, UNSUPPORTED_REPLY, message.message_id) : undefined;
      }
      const attachments = await fetchAttachments(api, message, filesDir, controller.signal);
      const prompt = promptFor(message, attachments);
      const messageId = paseoMessageId(message);
      await turns.admit(message.chat.id, async (startsTurn) => {
        pending.add(messageId, { chatId: message.chat.id, replyTo: message.message_id });
        try {
          await messenger.agents.ref(agentId).send(prompt, { messageId, activeTurnBehavior: "steer", images: attachments.images });
        } catch (error) {
          pending.forget(messageId);
          redactedLog(`telegram-bridge: could not reach agent ${agentId}: ${describeError(error)}`);
          await api.sendMessage(message.chat.id, `Could not reach the agent: ${describeError(error)}`, message.message_id);
          if (startsTurn) await turns.turnEnded();
        }
      });
    }

    async function poll() {
      const messenger = await Promise.race([paseo, once(controller.signal, "abort").then(() => null)]);
      if (!messenger) return;
      await runPoller({ api, offsets, onMessage: (message) => deliver(messenger, message), log: redactedLog, signal: controller.signal });
    }

    live = { api, agentId, log: redactedLog, turnEnded: turns.turnEnded };
    const polling = poll().catch((error: unknown) => redactedLog(`telegram-bridge: polling stopped: ${describeError(error)}`));
    return async () => {
      live = null;
      controller.abort();
      await polling;
    };
  }

  const posting = new Set<Promise<void>>();

  async function postReplies({ agent, outcome, timeline }: TurnEnded) {
    const current = live;
    if (!current || agent.id !== current.agentId) return;
    const releasing = current.turnEnded().catch((error: unknown) => current.log(`telegram-bridge: a held message was not handled: ${describeError(error)}`));
    await Promise.all([releasing, postReply(current, outcome, timeline)]);
  }

  async function postReply(current: NonNullable<typeof live>, outcome: TurnEnded["outcome"], timeline: TurnEnded["timeline"]) {
    const targets = pending.takeAnsweredBy(timeline);
    if (targets.length === 0) return;
    const plan = await planReply(replyFor(outcome, timeline), sendPolicy);
    await Promise.all(
      targets.map((target) =>
        sendReply(current.api, target, plan).catch((error: unknown) =>
          current.log(`telegram-bridge: could not post the reply to chat ${target.chatId}: ${describeError(error)}`),
        ),
      ),
    );
  }

  let stopCurrent = stopped;
  let switching = Promise.resolve();
  function restartWithLatestSettings() {
    switching = switching.then(async () => {
      await stopCurrent();
      stopCurrent = run(await settings.read());
    }).catch((error: unknown) => log(`telegram-bridge: could not read the settings: ${describeError(error)}`));
    return switching;
  }

  const unsubscribe = settings.subscribe(restartWithLatestSettings);
  void restartWithLatestSettings();
  function onTurnEnded(event: TurnEnded): Promise<void> {
    const post = postReplies(event).catch((error: unknown) => log(`telegram-bridge: could not post a reply: ${describeError(error)}`));
    posting.add(post);
    void post.finally(() => posting.delete(post));
    return post;
  }

  async function stop() {
    unsubscribe();
    await switching;
    await stopCurrent();
    await Promise.all(posting);
  }
  return { stop, onTurnEnded };
}
