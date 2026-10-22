import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const stateSchema = z.object({ offset: z.number().int() });

// The getUpdates offset: the id of the next Telegram update to fetch. Telegram drops every update below it.
export function createOffsetStore(file: string) {
  return {
    read(): number {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
        throw error;
      }
      return stateSchema.parse(JSON.parse(text)).offset;
    },
    write(offset: number): void {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const staging = `${file}.${randomUUID()}.tmp`;
      writeFileSync(staging, JSON.stringify({ offset }), { mode: 0o600, flag: "wx" });
      renameSync(staging, file);
    },
  };
}
export type OffsetStore = ReturnType<typeof createOffsetStore>;
