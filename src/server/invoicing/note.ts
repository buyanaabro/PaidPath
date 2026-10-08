import { generateText } from "ai";
import { getModel, modelChain, modelProviderOptions } from "@/lib/ai";

export type NoteInput = {
  projectName: string;
  clientName: string;
  phaseName: string;
  milestoneName: string;
  deliverables: string[];
  amountLabel: string;
};

export type DraftedNote = { note: string; source: "ai" | "template" };

const MAX_LENGTH = 600;

export function templateNote(input: NoteInput) {
  const milestone = input.milestoneName.replace(/^Milestone:\s*/i, "");
  const work = input.deliverables.length ? ` Delivered: ${input.deliverables.join(", ")}.` : "";
  return `Thank you for working with us on ${input.projectName}. This invoice covers "${milestone}" (${input.phaseName}).${work} You can pay securely online with PayPal.`.slice(
    0,
    MAX_LENGTH,
  );
}

/** Gemini drafts the client-facing note; falls back to a template so invoicing never blocks. */
export async function draftInvoiceNote(input: NoteInput): Promise<DraftedNote> {
  const prompt = [
    `Client: ${input.clientName}`,
    `Project: ${input.projectName}`,
    `Phase: ${input.phaseName}`,
    `Milestone being billed: ${input.milestoneName.replace(/^Milestone:\s*/i, "")} (${input.amountLabel})`,
    `Work delivered in this phase: ${input.deliverables.join("; ") || "see milestone"}`,
  ].join("\n");

  for (const [index, model] of modelChain().entries()) {
    try {
      const { text } = await generateText({
        model: getModel(model),
        providerOptions: modelProviderOptions,
        system:
          "You write the short note a freelancer puts on a PayPal invoice. Plain text, 2-3 sentences, " +
          "under 350 characters, warm and professional. Thank the client, summarize what was delivered " +
          "in this phase concretely, and mention they can pay securely via PayPal. No placeholders, " +
          "no greeting line, no signature, no markdown.",
        prompt,
        maxRetries: 0,
        // Primary gets more room (Render → Gemini latency varies); fallback stays short so
        // invoicing never waits long before using the template.
        abortSignal: AbortSignal.timeout(index === 0 ? 20_000 : 8_000),
      });
      const note = text.trim().replace(/\s+/g, " ");
      if (note.length >= 40) return { note: note.slice(0, MAX_LENGTH), source: "ai" };
    } catch (error) {
      console.warn(`Invoice note with ${model} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { note: templateNote(input), source: "template" };
}
