import { once } from "node:events";
import { basename, join } from "node:path";
import type { PluginHookContext, PluginLifecycleEvents, PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import type { bridgeSettings } from "../shared/settings.shared";
import { createIgnoredSenderLog, isAllowed } from "./allow-list.server";
import { createChatHistory, withAttached } from "./chat-history.server";
import { createChatTurns } from "./chat-turns.server";
import { describeError } from "./describe-error.server";
import { fetchAttachments } from "./attachments.server";
import { takeFollowUpChats } from "./follow-ups.server";
import { hasContentForAgent, historyEntryFor, isUnsupportedContent, paseoMessageId, promptFor, UNSUPPORTED_REPLY } from "./inbound.server";
import { createOffsetStore } from "./offset-store.server";
import { replyFor, type Timeline } from "./outbound.server";
import { createPendingReplies } from "./pending-replies.server";
import { planReply } from "./send-files.server";
import { sendReply } from "./send-reply.server";
import { runPoller } from "./poller.server";
import { createTelegramApi, redactToken, type TelegramApi, type TelegramMessage } from "./telegram-api.server";
import { type TranscribeVoice, voiceTools } from "./transcriber.server";
import { voiceNoteText } from "./voice-note.server";

type Settings = PluginSettings<typeof bridgeSettings.schema>;
type SettingsState = PluginSettingsState<typeof bridgeSettings.schema>;
type AgentHandle = ReturnType<PluginHookContext["paseo"]["agents"]["ref"]>;
type TurnEnded = Pick<PluginLifecycleEvents["agent.turn_ended"], "agent" | "outcome">;

interface TimelinePage {
  entries: ReadonlyArray<{ item: Timeline[number] }>;
  error: string | null;
}

export interface AgentMessenger {
  agents: {
    ref(agentId: string): Pick<AgentHandle, "send"> & { timeline: { refetch(options: { direction: "tail"; limit: number }): Promise<TimelinePage> } };
  };
}

interface BridgeOptions {
  settings: Settings;
  paseo: Promise<AgentMessenger>;
  dataDir: string;
  home: string;
  paseoHome: string;
  apiUrl: string;
  transcribe: TranscribeVoice;
  log(line: string): void;
}

const stopped = async () => {};
// Since Paseo 0.13 the turn_ended event carries no timeline. This many recent items reach back past a long turn.
const TIMELINE_TAIL = 200;

export function startBridge({ settings, paseo, dataDir, home, paseoHome, apiUrl, transcribe, log }: BridgeOptions) {
  const offsets = createOffsetStore(join(dataDir, "state.json"));
  const filesDir = join(dataDir, "files");
  const sendPolicy = { home, paseoHome, bridgeFilesDir: filesDir };
  const pending = createPendingReplies();
  const turns = createChatTurns();
  const history = createChatHistory(join(dataDir, "history"));
  function remember(chatId: number, who: string, text: string, { token, log }: { token: string; log(line: string): void }) {
    try {
      history.record(chatId, who, redactToken(text, token));
    } catch (error) {
      log(`telegram-bridge: could not write the history of chat ${chatId}: ${describeError(error)}`);
    }
  }
  let live: { api: TelegramApi; token: string; agentId: string; allowedChatIds: number[]; log(line: string): void } | null = null;

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
    const voiceToolPaths = voiceTools(values, home);

    async function deliver(messenger: AgentMessenger, received: TelegramMessage) {
      if (!isAllowed(received, values)) return logIgnored(received);
      if (!hasContentForAgent(received)) {
        return isUnsupportedContent(received) ? api.sendMessage(received.chat.id, UNSUPPORTED_REPLY, received.message_id) : undefined;
      }
      let message = received;
      if (received.voice) {
        const voiceNote = await voiceNoteText(api, received.voice, transcribe, voiceToolPaths, controller.signal);
        if (!voiceNote.ok) return api.sendMessage(received.chat.id, `Could not transcribe the voice note: ${voiceNote.reason}`, received.message_id);
        message = { ...received, text: received.caption === undefined ? voiceNote.text : `${voiceNote.text}\n${received.caption}` };
      }
      const { who, text } = historyEntryFor(message);
      remember(message.chat.id, who, text, { token: botToken, log: redactedLog });
      const attachments = await fetchAttachments(api, message, filesDir, controller.signal);
      const prompt = promptFor(message, attachments, history.fileFor(message.chat.id));
      const messageId = paseoMessageId(message);
      await turns.admit(message.chat.id, async (startsTurn) => {
        pending.add(messageId, { chatId: message.chat.id, replyTo: message.message_id });
        try {
          await messenger.agents.ref(agentId).send(prompt, { messageId, activeTurnBehavior: "steer", images: attachments.images });
        } catch (error) {
          pending.forget(messageId);
          redactedLog(`telegram-bridge: could not reach agent ${agentId}: ${describeError(error)}`);
          await api
            .sendMessage(message.chat.id, `Could not reach the agent: ${describeError(error)}`, message.message_id)
            .catch((sendError: unknown) => redactedLog(`telegram-bridge: could not tell chat ${message.chat.id}: ${describeError(sendError)}`));
          if (startsTurn) await turns.turnEnded();
        }
      });
    }

    async function poll() {
      const messenger = await Promise.race([paseo, once(controller.signal, "abort").then(() => null)]);
      if (!messenger) return;
      await runPoller({ api, offsets, onMessage: (message) => deliver(messenger, message), log: redactedLog, signal: controller.signal });
    }

    live = { api, token: botToken, agentId, allowedChatIds: values.allowedChatIds, log: redactedLog };
    const polling = poll().catch((error: unknown) => redactedLog(`telegram-bridge: polling stopped: ${describeError(error)}`));
    return async () => {
      live = null;
      controller.abort();
      await polling;
    };
  }

  const posting = new Set<Promise<void>>();

  async function postReplies({ agent, outcome }: TurnEnded) {
    const current = live;
    if (!current || agent.id !== current.agentId) return;
    await Promise.all([turns.turnEnded(), postReply(current, outcome)]);
  }

  async function readTimeline(agentId: string): Promise<Timeline> {
    const messenger = await paseo;
    const page = await messenger.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: TIMELINE_TAIL });
    if (page.error) throw new Error(`could not read the timeline of agent ${agentId}: ${page.error}`);
    return page.entries.map((entry) => entry.item);
  }

  async function postReply(current: NonNullable<typeof live>, outcome: TurnEnded["outcome"]) {
    const timeline = await readTimeline(current.agentId);
    const { text, chatIds } = takeFollowUpChats(replyFor(outcome, timeline));
    const targets: Array<{ chatId: number; replyTo?: number }> = pending.takeAnsweredBy(timeline);
    const waiting = pending.size();
    if (targets.length === 0 && waiting > 0) {
      current.log(`telegram-bridge: agent ${current.agentId} ended a turn without answering ${waiting} waiting Telegram message${waiting === 1 ? "" : "s"}`);
    }
    for (const chatId of chatIds) {
      if (targets.some((target) => target.chatId === chatId)) continue;
      if (current.allowedChatIds.includes(chatId)) targets.push({ chatId });
      else current.log(`telegram-bridge: did not post a follow-up to chat ${chatId}: it is not in the allowed chat ids`);
    }
    if (targets.length === 0) return;
    const plan = await planReply(text, sendPolicy);
    const posted = withAttached(plan.body, plan.files.map((file) => basename(file.path)));
    await Promise.all(
      targets.map((target) =>
        sendReply(current.api, target, plan).then(
          () => remember(target.chatId, "agent", posted, current),
          (error: unknown) => current.log(`telegram-bridge: could not post the reply to chat ${target.chatId}: ${describeError(error)}`),
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
