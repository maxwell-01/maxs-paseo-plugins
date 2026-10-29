export interface WaitingAgent {
  agentId: string;
  agentTitle: string | null;
  workspaceName: string;
  since: string;
}

// Long enough to cover an agent that messaged the holder and is idle until told the beam is free.
const FORGET_WAITER_AFTER_MS = 30 * 60_000;

export function createWaitingAgents() {
  const waiters = new Map<string, { agent: WaitingAgent; lastAskedAt: number }>();

  function forgetQuietWaiters() {
    for (const [agentId, waiter] of waiters) {
      if (Date.now() - waiter.lastAskedAt > FORGET_WAITER_AFTER_MS) {
        waiters.delete(agentId);
      }
    }
  }

  return {
    asked(agent: Omit<WaitingAgent, "since">) {
      const since = waiters.get(agent.agentId)?.agent.since ?? new Date().toISOString();
      waiters.set(agent.agentId, { agent: { ...agent, since }, lastAskedAt: Date.now() });
    },
    left(agentId: string) {
      waiters.delete(agentId);
    },
    list(): WaitingAgent[] {
      forgetQuietWaiters();
      return [...waiters.values()].map(({ agent }) => agent);
    },
  };
}
