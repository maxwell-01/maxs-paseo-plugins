type Send = (startsTurn: boolean) => Promise<void>;

// A turn ends in one reply, which goes to every chat whose message it took in, so a turn takes in one chat only.
export function createChatTurns() {
  let chatInTurn: number | undefined;
  let held: Array<{ chatId: number; send: Send }> = [];

  function admit(chatId: number, send: Send): Promise<void> {
    if (chatInTurn !== undefined && chatInTurn !== chatId) {
      held.push({ chatId, send });
      return Promise.resolve();
    }
    const startsTurn = chatInTurn === undefined;
    chatInTurn = chatId;
    return send(startsTurn);
  }

  async function turnEnded(): Promise<void> {
    chatInTurn = undefined;
    const waiting = held;
    held = [];
    for (const { chatId, send } of waiting) await admit(chatId, send);
  }

  return { admit, turnEnded };
}
