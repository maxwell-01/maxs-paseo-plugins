import { describe, expect, it } from "vitest";
import { createFakeAgentPort } from "./agent-port.fake";
import { createAgentNotices } from "./beam-agent-notice.server";

const beam = { workspaceId: "ws-1", mainPath: "/repos/app" };

describe("agent notices at beam-in and beam-out", () => {
  it("tells an idle agent in the beaming workspace that it is being mirrored onto main", async () => {
    const { port, sent } = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "idle" }]);
    await createAgentNotices().notifyIdleAgents(port, "ws-1", beam);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.agentId).toBe("a1");
    expect(sent[0]?.text).toContain("mirrored live onto the main checkout at /repos/app");
  });

  it("does not message agents in other workspaces", async () => {
    const { port, sent } = createFakeAgentPort([{ id: "a2", workspaceId: "ws-2", status: "idle" }]);
    await createAgentNotices().notifyIdleAgents(port, "ws-1", beam);
    expect(sent).toEqual([]);
  });

  it("does not message a working agent, because a message would cancel its work", async () => {
    const { port, sent } = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "running" }]);
    await createAgentNotices().notifyIdleAgents(port, "ws-1", beam);
    expect(sent).toEqual([]);
  });

  it("still tells the other agents when one cannot be reached, and names the one it missed", async () => {
    const { port, sent } = createFakeAgentPort(
      [
        { id: "a1", workspaceId: "ws-1", status: "idle" },
        { id: "a2", workspaceId: "ws-1", status: "idle" },
      ],
      { failSendFor: ["a1"] },
    );
    await expect(createAgentNotices().notifyIdleAgents(port, "ws-1", beam)).rejects.toThrow(
      "could not tell agent a1: daemon unreachable",
    );
    expect(sent.map((message) => message.agentId)).toEqual(["a2"]);
  });

  it("reaches idle agents on later pages of the agent list", async () => {
    const { port, sent } = createFakeAgentPort(
      [
        { id: "a1", workspaceId: "ws-1", status: "idle" },
        { id: "a2", workspaceId: "ws-2", status: "idle" },
        { id: "a3", workspaceId: "ws-1", status: "idle" },
      ],
      { pageSize: 1 },
    );
    await createAgentNotices().notifyIdleAgents(port, "ws-1", beam);
    expect(sent.map((message) => message.agentId)).toEqual(["a1", "a3"]);
  });

  it("tells an agent the beam has stopped only if it was told the beam started", async () => {
    const { port, sent } = createFakeAgentPort([
      { id: "a1", workspaceId: "ws-1", status: "idle" },
      { id: "a3", workspaceId: "ws-1", status: "idle" },
    ]);
    const notices = createAgentNotices();
    await notices.notifyAgent(port, "a1", "ws-1", beam);
    sent.length = 0;

    await notices.notifyIdleAgents(port, "ws-1", null);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.agentId).toBe("a1");
    expect(sent[0]?.text).toContain("no longer mirrored onto /repos/app");
  });
});

describe("agent notices when a working agent's turn ends", () => {
  it("delivers the beam-in notice once the agent is free", async () => {
    const { port, sent } = createFakeAgentPort([]);
    await createAgentNotices().notifyAgent(port, "a1", "ws-1", beam);
    expect(sent.map((message) => message.agentId)).toEqual(["a1"]);
  });


  it("does not repeat a notice when the agent's reply to it ends its turn", async () => {
    const { port, sent } = createFakeAgentPort([]);
    const notices = createAgentNotices();
    await notices.notifyAgent(port, "a1", "ws-1", beam);
    await notices.notifyAgent(port, "a1", "ws-1", beam);
    expect(sent).toHaveLength(1);
  });

  it("sends one notice when the turn-end hook and beam-in reach the same agent at once", async () => {
    const { port, sent } = createFakeAgentPort([]);
    const notices = createAgentNotices();
    await Promise.all([
      notices.notifyAgent(port, "a1", "ws-1", beam),
      notices.notifyAgent(port, "a1", "ws-1", beam),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("tries again at the next chance when a notice could not be sent", async () => {
    const failing = createFakeAgentPort([], { failSendFor: ["a1"] });
    const notices = createAgentNotices();
    await expect(notices.notifyAgent(failing.port, "a1", "ws-1", beam)).rejects.toThrow();

    const working = createFakeAgentPort([]);
    await notices.notifyAgent(working.port, "a1", "ws-1", beam);
    expect(working.sent).toHaveLength(1);
  });

  it("ignores agents that belong to no workspace", async () => {
    const { port, sent } = createFakeAgentPort([]);
    await createAgentNotices().notifyAgent(port, "a1", null, beam);
    expect(sent).toEqual([]);
  });
});
