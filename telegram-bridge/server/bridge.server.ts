import { once } from "node:events";
import { join } from "node:path";
import type { PluginHookContext, PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import type { bridgeSettings } from "../shared/settings.shared";
import { createIgnoredSenderLog, isAllowed } from "./allow-list.server";
import { isUnsupportedContent, paseoMessageId, promptFor, UNSUPPORTED_REPLY } from "./inbound.server";
import { createOffsetStore } from "./offset-store.server";
import { runPoller } from "./poller.server";
import { createTelegramApi, redactToken, type TelegramMessage } from "./telegram-api.server";

type Settings = PluginSettings<typeof bridgeSettings.schema>;
type SettingsState = PluginSettingsState<typeof bridgeSettings.schema>;
type AgentHandle = ReturnType<PluginHookContext["paseo"]["agents"]["ref"]>;

export interface AgentMessenger {
  agents: { ref(agentId: string): Pick<AgentHandle, "send"> };
}

interface BridgeOptions {
  settings: Settings;
  paseo: Promise<AgentMessenger>;
  dataDir: string;
  apiUrl: string;
  log(line: string): void;
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));
const stopped = async () => {};

export function startBridge({ settings, paseo, dataDir, apiUrl, log }: BridgeOptions) {
  const offsets = createOffsetStore(join(dataDir, "state.json"));

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

    async function deliver(messenger: AgentMessenger, message: TelegramMessage) {
      if (!isAllowed(message, values)) return logIgnored(message);
      const prompt = promptFor(message);
      if (prompt === null) return isUnsupportedContent(message) ? api.sendMessage(message.chat.id, UNSUPPORTED_REPLY, message.message_id) : undefined;
      try {
        await messenger.agents.ref(agentId).send(prompt, { messageId: paseoMessageId(message), activeTurnBehavior: "steer" });
      } catch (error) {
        redactedLog(`telegram-bridge: could not reach agent ${agentId}: ${describeError(error)}`);
        await api.sendMessage(message.chat.id, `Could not reach the agent: ${describeError(error)}`, message.message_id);
      }
    }

    async function poll() {
      const messenger = await Promise.race([paseo, once(controller.signal, "abort").then(() => null)]);
      if (!messenger) return;
      await runPoller({ api, offsets, onMessage: (message) => deliver(messenger, message), log: redactedLog, signal: controller.signal });
    }

    const polling = poll().catch((error: unknown) => redactedLog(`telegram-bridge: polling stopped: ${describeError(error)}`));
    return async () => {
      controller.abort();
      await polling;
    };
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
  return async () => {
    unsubscribe();
    await switching;
    await stopCurrent();
  };
}
