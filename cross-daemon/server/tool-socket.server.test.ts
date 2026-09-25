import { createConnection } from "node:net";

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "./temp-dir.test-support";
import { serveTools } from "./tool-socket.server";

describe("serveTools", () => {
  const stops: (() => void)[] = [];
  afterEach(() => stops.splice(0).forEach((stop) => stop()));

  it("starts on a fresh install, when the plugin's state folder does not exist yet", async () => {
    const socketPath = join(makeTempDir("cd-"), "not-yet", "tools.sock");
    stops.push(
      serveTools(socketPath, {
        definitions: [],
        call: async () => ({ text: "pong" }),
      }),
    );
    const reply = await new Promise<string>((resolve, reject) => {
      let body = "";
      const connect = () => {
        const socket = createConnection(socketPath);
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => (body += chunk));
        socket.on("end", () => resolve(body));
        socket.on("error", reject);
        socket.end(JSON.stringify({ type: "call", name: "ping", arguments: {}, callerAgentId: null }));
      };
      setTimeout(connect, 50);
    });
    expect(JSON.parse(reply)).toEqual({ text: "pong" });
  });
});
