import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeSettings } from "../shared/settings.shared";
import { type AgentMessenger, startBridge } from "./bridge.server";
import { type FakeBotApi, startFakeBotApi } from "./fake-bot-api.test-support";
import { replyHint } from "./inbound.server";
import { makeTempDir } from "./temp-dir.test-support";

const TOKEN = "123:bridge-token";
const MAX = 111;
const GROUP = -100200;
const configured: BridgeSettings = { botToken: TOKEN, agentId: "agent-1", allowedUserIds: [MAX], allowedChatIds: [GROUP, MAX] };
const groupChat = { id: GROUP, type: "supergroup", title: "Crew" };
const directChat = { id: MAX, type: "private" };
const update = (updateId: number, fields: Record<string, unknown>, from = MAX, chat: object = groupChat) => ({
  update_id: updateId,
  message: { message_id: updateId, chat, from: { id: from, first_name: "Max" }, ...fields },
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
  const paseoHome = makeTempDir("tg-paseo-home-");
  const bridge = startBridge({ settings, paseo, dataDir: join(paseoHome, "plugin-data", "telegram-bridge"), home: makeTempDir("tg-home-"), paseoHome, apiUrl: bot.url, log: (line) => logs.push(line) });
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
        text: `[Telegram, Max, in Crew]: status?\n${replyHint(GROUP)}`,
        options: { messageId: `telegram-${GROUP}-5`, activeTurnBehavior: "steer", images: [] },
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
    expect(logs).toEqual([`telegram-bridge: ignored a message from user 999 in chat ${GROUP} (Crew); add both ids to the settings to allow it`]);
  });

  it("tells the chat when a message kind cannot reach the agent", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(6, { sticker: { file_id: "x" } })] } });
    const { stop } = start();
    await until(() => sentMessages().length === 1);
    await stop();
    expect(sentMessages()).toEqual([
      { chat_id: GROUP, text: "Only text, photos and files reach the agent.", reply_parameters: { message_id: 6, allow_sending_without_reply: true } },
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

  it("still delivers a second chat's message when the agent could not take the first", async () => {
    bot.reply("getUpdates", { json: { ok: true, result: [update(7, { text: "hi" }), update(8, { text: "hello" }, MAX, directChat)] } });
    const { stop } = start(undefined, Promise.resolve(fakeAgents({ fail: true }).messenger));
    await until(() => sentMessages().length === 2);
    await stop();
    expect(sentMessages().map((body) => body.chat_id)).toEqual([GROUP, MAX]);
  });

  it("still delivers a second chat's message when telling the first chat about the failure fails too", async () => {
    bot.reply("sendMessage", { status: 403, json: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    bot.reply("getUpdates", { json: { ok: true, result: [update(7, { text: "hi" }), update(8, { text: "hello" }, MAX, directChat)] } });
    const { stop } = start(undefined, Promise.resolve(fakeAgents({ fail: true }).messenger));
    await until(() => sentMessages().length === 2);
    await stop();
    expect(sentMessages().map((body) => body.chat_id)).toEqual([GROUP, MAX]);
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

  it("answers each chat in its own turn when a second chat writes while the agent answers the first", async () => {
    const agents = fakeAgents();
    bot.reply("getUpdates", { json: { ok: true, result: [update(5, { text: "group question" }), update(6, { text: "direct question" }, MAX, directChat)] } });
    const { stop, onTurnEnded } = start(undefined, Promise.resolve(agents.messenger));
    await until(() => bot.calls.filter((call) => call.method === "getUpdates").length >= 2);
    expect(agents.sent.map((sent) => sent.text.split("\n")[0])).toEqual(["[Telegram, Max, in Crew]: group question"]);

    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("group answer")] });
    await until(() => agents.sent.length === 2);
    expect(agents.sent[1].text.split("\n")[0]).toBe("[Telegram, Max, in direct chat]: direct question");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("group answer"), userMessage(`telegram-${MAX}-6`), said("direct answer")] });
    await stop();
    expect(sentMessages().map((body) => [body.chat_id, body.text])).toEqual([
      [GROUP, "group answer"],
      [MAX, "direct answer"],
    ]);
  });

  it("logs a reply Telegram refuses, without throwing out of the hook", async () => {
    const { stop, onTurnEnded, logs } = await afterDelivering("status?");
    bot.reply("sendMessage", { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: chat not found" } });
    await expect(onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said("hi")] })).resolves.toBeUndefined();
    await stop();
    expect(logs).toEqual([`telegram-bridge: could not post the reply to chat ${GROUP}: sendMessage failed: 400 Bad Request: chat not found`]);
  });
});

describe("bridge, follow-ups", () => {
  const STRANGER_CHAT = -100999;
  async function started() {
    const bridge = start();
    await until(() => bot.calls.length > 0);
    return bridge;
  }

  it("posts a later turn's reply to each allowed chat it names, not as a reply, without the marker", async () => {
    const { stop, onTurnEnded } = await started();
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage("app-1"), said(`The download is done.\n[[telegram: ${GROUP}]]\n[[telegram: ${MAX}]]`)] });
    await stop();
    expect(sentMessages()).toEqual([
      { chat_id: GROUP, text: "The download is done." },
      { chat_id: MAX, text: "The download is done." },
    ]);
  });

  it("refuses a chat that is not allowed, and logs it", async () => {
    const { stop, onTurnEnded, logs } = await started();
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage("app-1"), said(`secret\n[[telegram: ${STRANGER_CHAT}]]`)] });
    await stop();
    expect(sentMessages()).toEqual([]);
    expect(logs).toEqual([`telegram-bridge: did not post a follow-up to chat ${STRANGER_CHAT}: it is not in the allowed chat ids`]);
  });

  it("posts once to a chat the turn already answers", async () => {
    const { stop, onTurnEnded } = await afterDelivering("status?");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said(`All green.\n[[telegram: ${GROUP}]]`)] });
    await stop();
    expect(sentMessages()).toEqual([{ chat_id: GROUP, text: "All green.", reply_parameters: { message_id: 5, allow_sending_without_reply: true } }]);
  });

  it("sends a follow-up's files under the same rules as a reply", async () => {
    const dir = makeTempDir("tg-out-");
    writeFileSync(join(dir, "report.pdf"), "pdf");
    writeFileSync(join(dir, ".env"), "TOKEN=x");
    const { stop, onTurnEnded } = await started();
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage("app-1"), said(`[[send: ${join(dir, "report.pdf")}]]\n[[send: ${join(dir, ".env")}]]\n[[telegram: ${MAX}]]`)] });
    await stop();
    expect(bot.calls.filter((call) => call.method !== "getUpdates")).toEqual([
      { method: "sendMessage", body: { chat_id: MAX, text: `Could not send ${join(dir, ".env")}: it is a hidden file.` } },
      { method: "sendDocument", body: { chat_id: String(MAX), document: { name: "report.pdf", text: "pdf" } } },
    ]);
  });

  it("leaves a marker inside a code block alone", async () => {
    const { stop, onTurnEnded } = await started();
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage("app-1"), said(`\`\`\`\n[[telegram: ${MAX}]]\n\`\`\``)] });
    await stop();
    expect(sentMessages()).toEqual([]);
  });
});

describe("bridge, files", () => {
  it("passes a photo to the agent as an image, with its caption as the message", async () => {
    const agents = fakeAgents();
    bot.serveFile("large", Buffer.from("jpeg"));
    bot.reply("getUpdates", { json: { ok: true, result: [update(5, { photo: [{ file_id: "small" }, { file_id: "large" }], caption: "What is this?" })] } });
    const { stop } = start(undefined, Promise.resolve(agents.messenger));
    await until(() => agents.sent.length === 1);
    await stop();
    expect(agents.sent[0].text.split("\n")[0]).toBe("[Telegram, Max, in Crew]: What is this?");
    expect(agents.sent[0].options).toMatchObject({ images: [{ data: Buffer.from("jpeg").toString("base64"), mimeType: "image/jpeg" }] });
  });

  it("uploads each file the reply names, as a photo or a file, and says which it could not send", async () => {
    const dir = makeTempDir("tg-out-");
    writeFileSync(join(dir, "chart.png"), "png bytes");
    writeFileSync(join(dir, "data.csv"), "a,b");
    const { stop, onTurnEnded } = await afterDelivering("send me the chart");
    const reply = ["Here you go.", `[[send: ${join(dir, "chart.png")}]]`, `[[send: ${join(dir, "data.csv")}]]`, "[[send: notes.txt]]"].join("\n");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said(reply)] });
    await stop();
    const outbound = bot.calls.filter((call) => call.method !== "getUpdates");
    expect(outbound).toEqual([
      {
        method: "sendMessage",
        body: { chat_id: GROUP, text: "Here you go.\n\nCould not send notes.txt: it is not an absolute path.", reply_parameters: { message_id: 5, allow_sending_without_reply: true } },
      },
      { method: "sendPhoto", body: { chat_id: String(GROUP), photo: { name: "chart.png", text: "png bytes" } } },
      { method: "sendDocument", body: { chat_id: String(GROUP), document: { name: "data.csv", text: "a,b" } } },
    ]);
  });

  it("sends only the file when the reply is nothing but a send line", async () => {
    const file = join(makeTempDir("tg-out-"), "report.pdf");
    writeFileSync(file, "pdf");
    const { stop, onTurnEnded } = await afterDelivering("report please");
    await onTurnEnded({ agent: agent("agent-1"), outcome: completed, timeline: [userMessage(`telegram-${GROUP}-5`), said(`[[send: ${file}]]`)] });
    await stop();
    expect(bot.calls.filter((call) => call.method !== "getUpdates").map((call) => call.method)).toEqual(["sendDocument"]);
  });
});
