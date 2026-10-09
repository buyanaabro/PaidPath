import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string };
};
export type GeminiContent = { role?: string; parts?: Part[] };

/**
 * Stable key for a conversation: user text, called function names + args, and returned
 * function names (not their payloads, which contain live dates). Lets E2E tests replay
 * recorded Gemini responses without spending free-tier quota.
 */
export function conversationKey(contents: GeminiContent[]) {
  const shape = contents.map((c) => [
    c.role ?? "user",
    (c.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) =>
        p.functionCall
          ? `call:${p.functionCall.name}:${JSON.stringify(p.functionCall.args ?? {})}`
          : p.functionResponse
            ? `result:${p.functionResponse.name}`
            : c.role === "model"
              ? "text"
              : `text:${(p.text ?? "").trim()}`,
      ),
  ]);
  return createHash("sha1").update(JSON.stringify(shape)).digest("hex");
}

export class FixtureStore {
  constructor(private readonly file: string) {}

  private read(): Record<string, unknown> {
    return existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Record<string, unknown>) : {};
  }

  get(key: string) {
    return this.read()[key];
  }

  put(key: string, response: unknown) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ ...this.read(), [key]: response }, null, 1));
  }
}
