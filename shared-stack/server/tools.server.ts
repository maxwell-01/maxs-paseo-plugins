import { z } from "zod";
import type { Engine } from "./engine.server";
import type { ToolResult, Tools } from "./tool-socket.server";
import { describeEntry, type QueueState } from "./queue.server";

// Agent tool calls end after 10 minutes; stay well inside that.
export const MAX_WAIT_SECONDS = 540;
const DEFAULT_WAIT_SECONDS = 300;
const POLL_MS = 1_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function describeQueue(state: QueueState, me: { daemon: string; agentId: string }) {
  if (state.waiting.length === 0) return "Nobody is waiting.";
  const list = state.waiting.map((entry, index) => `${index + 1}. ${describeEntry(entry)}${entry.daemon === me.daemon && entry.agentId === me.agentId ? " (you)" : ""}`);
  return `Waiting, in order: ${list.join("; ")}.`;
}

function hostLine(engine: Engine): string {
  const host = engine.readHost();
  if (!host) return "No host daemon has reported yet, so nothing is syncing onto the stack.";
  const ageSeconds = Math.round((Date.now() - Date.parse(host.heartbeatAt)) / 1000);
  const stale = ageSeconds > 30 ? ` Its last heartbeat was ${ageSeconds} s ago, so it may be down.` : "";
  const error = host.error ? ` Its last sync failed: ${host.error}` : "";
  return `The stack is hosted by ${host.daemon}${host.stackUrl ? ` at ${host.stackUrl}` : ""}.${stale}${error}`;
}

function holdingText(engine: Engine, state: QueueState): string {
  const holder = state.holder;
  const synced = holder?.snapshot ? ` Last snapshot published ${holder.snapshot.at}.` : " Your first snapshot is on its way.";
  const waiting = state.waiting.length > 0 ? ` ${state.waiting.length} agent(s) are waiting, so release as soon as you are done.` : "";
  return (
    `You hold the shared stack. Your working tree is synced onto it within a few seconds of each change.${synced} ${hostLine(engine)}` +
    ` Your hold runs out at ${holder?.leaseUntil}; any stack tool call or file change extends it. Call stack_release when you are done.${waiting}`
  );
}

interface Caller {
  agentId: string;
  signal: AbortSignal;
}

interface Tool {
  name: string;
  description: string;
  input: z.ZodType;
  run(input: never, caller: Caller): Promise<ToolResult> | ToolResult;
}

const defineTool = <Schema extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: Schema;
  run(input: z.output<Schema>, caller: Caller): Promise<ToolResult> | ToolResult;
}): Tool => tool as Tool;

export function createStackTools(engine: Engine): Tools {
  const who = (caller: Caller) => ({ daemon: engine.daemon, agentId: caller.agentId });

  const tools = [
    defineTool({
      name: "stack_status",
      description: "Shows who holds the shared dev stack, who is waiting for it, in order, and your own place. If you hold it, this also extends your hold.",
      input: z.object({}),
      run(_input, caller) {
        const state = engine.renew(who(caller));
        const place = engine.placeOf(state, who(caller));
        const holder = state.holder ? `Held by ${describeEntry(state.holder)} since ${state.holder.grantedAt}.` : "Nobody holds the stack.";
        const yours = place === 0 ? " That is you." : place ? ` You are number ${place} in the queue.` : " You are not in the queue.";
        return { text: `${holder}${yours} ${describeQueue(state, who(caller))} ${hostLine(engine)}` };
      },
    }),
    defineTool({
      name: "stack_join",
      description:
        "Queues you for the shared dev stack that agents on every Paseo daemon on this machine take turns on, and waits up to waitSeconds " +
        `(default ${DEFAULT_WAIT_SECONDS}, most ${MAX_WAIT_SECONDS}; 0 just joins) to reach the front. When you hold it, your workspace's working tree ` +
        "is synced onto the stack so it reloads with your changes. You keep your place if the call ends first: call it again to keep waiting, " +
        "or stop and you will get a message when the stack is yours. Call stack_release when you are done.",
      input: z.object({ waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional() }),
      async run({ waitSeconds }, caller) {
        const me = who(caller);
        let state = engine.join(await engine.callerFor(caller.agentId));
        const deadline = Date.now() + (waitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;
        engine.waiting(me.agentId, true);
        try {
          while (engine.placeOf(state, me) !== 0 && Date.now() < deadline && !caller.signal.aborted) {
            await sleep(Math.min(POLL_MS, deadline - Date.now()), caller.signal);
            state = engine.read();
            if (engine.placeOf(state, me) === null) state = engine.join(await engine.callerFor(caller.agentId));
          }
        } finally {
          engine.waiting(me.agentId, false);
        }
        if (caller.signal.aborted) return { text: "stack_join was cancelled. You are still in the queue; call stack_release to leave it.", isError: true };
        const place = engine.placeOf(state, me);
        if (place === 0) return { text: holdingText(engine, engine.renew(me)) };
        const holder = state.holder ? `${describeEntry(state.holder)} holds the stack.` : "Nobody holds the stack yet.";
        return {
          text: `You are number ${place} in the queue. ${holder} ${describeQueue(state, me)} Call stack_join again to keep waiting, or stop and you will get a message when it is your turn.`,
        };
      },
    }),
    defineTool({
      name: "stack_release",
      description: "Releases the shared dev stack if you hold it, or takes you out of its queue. The stack checkout returns to its own state when nobody holds it.",
      input: z.object({}),
      run(_input, caller) {
        const me = who(caller);
        const place = engine.placeOf(engine.read(), me);
        if (place === null) return { text: "You were not holding or waiting for the shared stack." };
        const state = engine.leave(me, "released by the agent");
        const next = state.holder ? ` ${describeEntry(state.holder)} has it now.` : "";
        return { text: place === 0 ? `Released the shared stack.${next}` : "You left the queue." };
      },
    }),
  ];

  return {
    definitions: tools.map(({ name, description, input }) => ({ name, description, inputSchema: z.toJSONSchema(input) as Record<string, unknown> })),
    async call(name, args, caller) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return { text: `Unknown shared-stack tool: ${name}`, isError: true };
      if (!caller.agentId) return { text: "shared-stack tools only work inside a Paseo agent (its agent ID is not set).", isError: true };
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) return { text: `Invalid input for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };
      return tool.run(parsed.data as never, { agentId: caller.agentId, signal: caller.signal });
    },
  };
}
