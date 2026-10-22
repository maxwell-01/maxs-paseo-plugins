import type { Timeline } from "./outbound.server";

export interface ReplyTarget {
  chatId: number;
  replyTo: number;
}

// Held in memory only: after a restart, an id from before it could match a later turn started from the app.
export function createPendingReplies() {
  const pending = new Map<string, ReplyTarget>();
  return {
    add(paseoMessageId: string, target: ReplyTarget) {
      pending.set(paseoMessageId, target);
    },
    forget(paseoMessageId: string) {
      pending.delete(paseoMessageId);
    },
    takeAnsweredBy(timeline: Timeline): ReplyTarget[] {
      if (pending.size === 0) return [];
      const newestPerChat = new Map<number, ReplyTarget>();
      for (const item of timeline) {
        if (item.type !== "user_message" || !item.messageId) continue;
        const target = pending.get(item.messageId);
        if (!target) continue;
        pending.delete(item.messageId);
        const known = newestPerChat.get(target.chatId);
        if (!known || target.replyTo > known.replyTo) newestPerChat.set(target.chatId, target);
      }
      return [...newestPerChat.values()];
    },
  };
}
