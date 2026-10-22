import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const wakeBridge = defineRpc({ name: "bridge.wake", input: z.object({}), output: z.object({}) });
