import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeSettings } from "../shared/settings.shared";
import { type AgentMessenger, startBridge } from "./bridge.server";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.test-support";
import { makeTempDir } from "./temp-dir.test-support";

const TOKEN = "123:bridge-token";
const MAX = 111;
const GROUP = -100200;
const configured: BridgeSettings = { botToken: TOKEN, agentId: "agent-1", allowedUserIds: [MAX], allowedChatIds: [GROUP] };
const update = (updateId: number, fields: Record<string, unknown>, from = MAX) => ({
  update_id: updateId,
  message: { message_id: updateId, chat: { id: GROUP, type: "supergroup" }, from: { id: from, first_name: "Max" }, ...fields },
});

let bot: FakeBotApi;
beforeEach(async () => {
  bot = await startFakeBotApi(TOKEN);
});
afterEach(() => bot.close());

function fakeSettings(saved: BridgeSettings) {
  let values = saved;
  const listeners: Array<(state: { status: "ready"; revision: string; values: BridgeSettings }) => void> = [];
  return {
    read: async () => ({ status: "ready" as const, revision: "1", values }),
    subscribe(listener: (typeof listeners)[number]) {
      listeners.push(listener);
      return () => {};
    },
    change(next: BridgeSettings) {
      values = next;
      return Promise.all(listeners.map((listener) => listener({ status: "ready", revision: "2", values: next })));
    },
  };
}

function fakeAgents({ fail = false } = {}) {
  const sent: Array<{ agentId: string; text: string; options: unknown }> = [];
  const messenger: AgentMessenger = {
    agents: {
      ref: (agentId) => ({
        async send(text, options) {
          if (fail) throw new Error("Agent agent-1 not found");
          sent.push({ agentId, text, options });
        },
      }),
    },
  };
  return { sent, messenger };
}

async function until(condition: () => boolean) {
  for (let tries = 0; !condition(); tries += 1) {
    if (tries > 200) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function start(settings = fakeSettings(configured), paseo: Promise<AgentMessenger> = Promise.resolve(fakeAgents().messenger)) {
  const logs: string[] = [];
  const bridge = startBridge({ settings, paseo, dataDir: makeTempDir("tg-bridge-"), apiUrl: bot.url, log: (line) => logs.push(line) });
  return { ...bridge, logs };
}

const sentMessages = () => bot.calls.filter((call) => call.method === "sendMessage").map((call) => call.body);

describe("bridge, inbound", () => {
  it("sends an allowed message to the agent's conversation without interrupting its turn", async () => {
    const agents = fakeAgents();
    bot.reply("getUpdates", { json: { ok: true, result: [update(5, { text: "status?" })] } });
    const { stop } = start(undefined, Promise.resolve(agents.messenger));
    await until(() => agents.sent.length === 1);
    await stop();
    expect(agents.sent).toEqual([
      {
        agentId: "agent-1",
        text: "[Telegram, Max]: status?\n(Your reply goes back to this Telegram chat.)",
        options: { messageId: `telegram-${GROUP}-5`, activeTurnBehavior: "steer" },
      },
    ]);
  });

  it("never sends a stranger's message, and logs the ids without the text or token", async () => {
    const agents = fakeAgents();
    bot.reply("getUpdates", { json: { ok: true, result: [update(5, { text: `leak ${TOKEN}` }, 999)] } });
    const { stop, logs } = start(undefined, Promise.resolve(agents.messenger));
    await until(() => logs.length === 1);
    await stop();
    expect(agents.sent).toEqual([]);
    expect(logs).toEqual([`telegram-bridge: ignored a message from user 999 in chat ${GROUP}; add both ids to the settings to allow it`]);
  });

  it("tells the chat when a message kind cannot reach the agent", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(6, { sticker: { file_id: "x" } })] } });
    const { stop } = start();
    await until(() => sentMessages().length === 1);
    await stop();
    expect(sentMessages()).toEqual([
      { chat_id: GROUP, text: "Only text messages reach the agent.", reply_parameters: { message_id: 6, allow_sending_without_reply: true } },
    ]);
  });

  it("stays quiet on a service message, such as a pin", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(6, { pinned_message: { message_id: 1 } }), update(7, { sticker: { file_id: "x" } })] } });
    const { stop } = start();
    await until(() => sentMessages().length === 1);
    await stop();
    expect(sentMessages().map((body) => body.reply_parameters)).toEqual([{ message_id: 7, allow_sending_without_reply: true }]);
  });

  it("tells the chat when the agent cannot be reached", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(7, { text: "hi" })] } });
    const { stop, logs } = start(undefined, Promise.resolve(fakeAgents({ fail: true }).messenger));
    await until(() => sentMessages().length === 1);
    await stop();
    expect(sentMessages()[0].text).toBe("Could not reach the agent: Agent agent-1 not found");
    expect(logs).toEqual(["telegram-bridge: could not reach agent agent-1: Agent agent-1 not found"]);
  });

  it("stays off until a token and an agent id are set, then starts on the change", async () => {
    const settings = fakeSettings({ ...configured, botToken: "" });
    const { stop, logs } = start(settings);
    await until(() => logs.length === 1);
    expect(logs).toEqual(["telegram-bridge: set a bot token and an agent id to turn the bridge on"]);
    expect(bot.calls).toEqual([]);
    await settings.change(configured);
    await until(() => bot.calls.length > 0);
    await stop();
    expect(bot.calls[0].method).toBe("getUpdates");
  });

  it("does not poll before Paseo is reachable, and still stops cleanly", async () => {
    const { stop } = start(undefined, new Promise<AgentMessenger>(() => {}));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await stop();
    expect(bot.calls).toEqual([]);
  });
});

const agent = (id: string) => ({ id, workspaceId: null, parentAgentId: null, provider: "claude", cwd: "/tmp", title: null });
const completed = { kind: "completed" as const };
const userMessage = (messageId: string) => ({ type: "user_message" as const, text: "", messageId });
const said = (text: string) => ({ type: "assistant_message" as const, text });

async function afterDelivering(text: string) {
  const agents = fakeAgents();
  bot.reply("getUpdates", { json: { ok: true, result: [update(5, { text })] } });
  const bridge = start(undefined, Promise.resolve(agents.messenger));
  await until(() => agents.sent.length === 1);
  return bridge;
}

describe("bridge, replies", () => {
  it("posts the final reply of a turn that took in a Telegram message to that chat", async () => {
    const { stop, onTurnEnded } = await afterDelivering("status?");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("All green.")] });
    await stop();
    expect(sentMessages()).toEqual([{ chat_id: GROUP, text: "All green.", reply_parameters: { message_id: 5, allow_sending_without_reply: true } }]);
  });

  it("answers a turn that ends before the send call returns", async () => {
    let bridge: ReturnType<typeof start> | undefined;
    const quickAgent: AgentMessenger = {
      agents: {
        ref: () => ({
          async send(_text, options) {
            await bridge?.onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(options?.messageId ?? ""), said("quick")] });
          },
        }),
      },
    };
    bot.reply("getUpdates", { json: { ok: true, result: [update(5, { text: "ping" })] } });
    bridge = start(undefined, Promise.resolve(quickAgent));
    await until(() => sentMessages().length === 1);
    await bridge.stop();
    expect(sentMessages().map((body) => body.text)).toEqual(["quick"]);
  });

  it("does not mirror a turn started from the app, or another agent's turn", async () => {
    const { stop, onTurnEnded } = await afterDelivering("status?");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage("app-1"), said("app answer")] });
    await onTurnEnded({ agent: agent("agent-2"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("not ours")] });
    await stop();
    expect(sentMessages()).toEqual([]);
  });

  it("splits a long reply, replying to the message only with the first part", async () => {
    const { stop, onTurnEnded } = await afterDelivering("write a lot");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("x".repeat(5000))] });
    await stop();
    expect(sentMessages().map((body) => [String(body.text).length, body.reply_parameters !== undefined])).toEqual([
      [4096, true],
      [904, false],
    ]);
  });

  it("tells the chat when the turn failed", async () => {
    const { stop, onTurnEnded } = await afterDelivering("status?");
    await onTurnEnded({ agent: agent("agent-1"), outcome: { kind: "failed", error: { message: "rate limited" } }, timeline: [userMessage(`telegram-${GROUP}-5`)] });
    await stop();
    expect(sentMessages().map((body) => body.text)).toEqual(["The agent's turn failed: rate limited"]);
  });

  it("logs a reply Telegram refuses, without throwing out of the hook", async () => {
    const { stop, onTurnEnded, logs } = await afterDelivering("status?");
    bot.reply("sendMessage", { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: chat not found" } });
    await expect(onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("hi")] })).resolves.toBeUndefined();
    await stop();
    expect(logs).toEqual([`telegram-bridge: could not post the reply to chat ${GROUP}: sendMessage failed: 400 Bad Request: chat not found`]);
  });
});
