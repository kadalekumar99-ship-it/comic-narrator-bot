/**
 * Prompt verification pass.
 *
 * Runs AFTER every prompt has been written and BEFORE any image is generated.
 * Each prompt is checked one by one against its own timestamp and script line:
 * blank, truncated, non-English or mismatched prompts are rewritten by the text
 * engine; everything else is kept exactly as written.
 */

import { zaiChat } from "./zai.server";
import {
  isEnglishish,
  mentionsLine,
  parseNumberedList,
  sanitizePrompt,
  normalizeLeadCharacter,
  writePrompts,
  isShortLine,
} from "./manga.server";

export type VerifyItem = {
  /** 1-based line number (timestamp position in the script). */
  n: number;
  start: number;
  end: number;
  text: string;
  prompt: string;
};

export type VerifyResult = {
  n: number;
  prompt: string;
  /** "ok" kept as written, "rewritten" replaced, "failed" still unusable. */
  status: "ok" | "rewritten" | "failed";
  reason?: string;
};

/** Shortest a usable prompt may be. Anything below this is a truncated answer. */
const MIN_PROMPT_CHARS = 60;

/** Local, no-cost audit of one prompt against its own timestamp. */
export function localCheck(item: VerifyItem): string | null {
  const p = (item.prompt ?? "").trim();
  if (!p) return "blank prompt";
  if (p.length < MIN_PROMPT_CHARS) return "prompt too short / incomplete";
  if (/[,;:\-]$/.test(p) || /\b(and|with|the|a|of|in|as)$/i.test(p)) return "prompt ends mid-sentence";
  if (!isEnglishish(p)) return "prompt is not in English";
  // Short script lines legitimately continue the previous beat, so a word
  // overlap cannot be demanded of them.
  if (!isShortLine(item.text) && isEnglishish(item.text) && !mentionsLine(p, item.text))
    return "prompt does not match this timestamp's line";
  return null;
}

function auditInstruction(bible: string, items: VerifyItem[]): string {
  const listing = items
    .map(
      (it) =>
        `${it.n}. TIMESTAMP [${it.start}s-${it.end}s]\n   SCRIPT LINE: ${it.text}\n   CURRENT PROMPT: ${it.prompt || "(missing)"}`,
    )
    .join("\n\n");
  return [
    "You are checking image prompts for a comic. Each numbered entry has a timestamp, the script line spoken at that timestamp, and the prompt currently written for it.",
    "",
    "For EVERY entry, judge whether the current prompt truly depicts that exact timestamp's line: complete sentence, in English, single scene, correct characters and action, no text in frame.",
    "If it is correct, repeat it unchanged. If it is blank, incomplete, cut off, generic, or describes a different moment, WRITE A NEW COMPLETE PROMPT for that timestamp.",
    "",
    "CHARACTER CONSISTENCY SHEET (appearances are fixed):",
    normalizeLeadCharacter(bible).slice(0, 4000),
    "",
    "ENTRIES:",
    listing,
    "",
    `Answer with exactly ${items.length} numbered lines, using the SAME numbers as above (${items.map((i) => i.n).join(", ")}).`,
    "Each line is ONE single-paragraph image prompt of 40-90 words, in English, describing one single illustrated scene with a full background. No commentary, no labels, no quotes, no text inside the picture.",
  ].join("\n");
}

/**
 * Maps an audit answer back to the global timestamp numbers it was asked for.
 * Later batches are numbered 11-20, 21-30, etc.; parsing them with the batch
 * size (10) used to discard those global numbers and silently keep unchecked
 * prompts. A positional 1..N answer is accepted only as an explicit fallback.
 */
export function parseAuditPrompts(raw: string, items: VerifyItem[]): Map<number, string> {
  const mapped = new Map<number, string>();
  if (items.length === 0) return mapped;

  const highest = Math.max(...items.map((item) => item.n));
  const global = parseNumberedList(raw, highest);
  for (const item of items) {
    const candidate = global[item.n - 1]?.trim();
    if (candidate) mapped.set(item.n, candidate);
  }
  if (mapped.size > 0) return mapped;

  const positional = parseNumberedList(raw, items.length);
  items.forEach((item, index) => {
    const candidate = positional[index]?.trim();
    if (candidate) mapped.set(item.n, candidate);
  });
  return mapped;
}

/**
 * Verifies one batch of already-written prompts, rewriting the bad ones.
 * The batch is checked entry by entry; a rewrite is accepted only when it
 * passes the same per-timestamp checks the original failed.
 */
export async function verifyPromptBatch(
  bible: string,
  items: VerifyItem[],
  all: { index: number; start: number; end: number; text: string }[],
): Promise<VerifyResult[]> {
  const out = new Map<number, VerifyResult>();
  const suspect: VerifyItem[] = [];

  for (const item of items) {
    const problem = localCheck(item);
    if (problem) {
      suspect.push(item);
      out.set(item.n, { n: item.n, prompt: item.prompt ?? "", status: "failed", reason: problem });
    } else {
      out.set(item.n, { n: item.n, prompt: sanitizePrompt(item.prompt.trim()), status: "ok" });
    }
  }

  // EVERY prompt is audited by the model against its own timestamp — not only
  // the ones that failed the cheap local checks. A prompt that reads fine but
  // depicts the wrong moment can only be caught here.
  try {
    const raw = await zaiChat(auditInstruction(bible, items), {
      temperature: 0.5,
      maxOutputTokens: Math.min(20_000, 400 * items.length + 800),
    });
    const parsed = parseAuditPrompts(raw, items);
    items.forEach((item) => {
      const candidate = parsed.get(item.n) ?? "";
      if (!candidate) return;
      const cleaned = sanitizePrompt(candidate);
      const problem = localCheck({ ...item, prompt: cleaned });
      if (problem) return;
      const before = sanitizePrompt((item.prompt ?? "").trim());
      const changed = cleaned.replace(/\s+/g, " ") !== before.replace(/\s+/g, " ");
      const previous = out.get(item.n) as VerifyResult;
      if (!changed) {
        out.set(item.n, { n: item.n, prompt: cleaned, status: "ok" });
        return;
      }
      out.set(item.n, {
        n: item.n,
        prompt: cleaned,
        status: "rewritten",
        reason: previous.reason ?? "did not match its timestamp",
      });
    });
  } catch (error) {
    console.error(
      `[verify] batch audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }


  // Anything still unusable gets one focused single-line rewrite from the
  // ordinary prompt writer, so no timestamp is left without a prompt.
  for (const item of suspect) {
    const current = out.get(item.n) as VerifyResult;
    if (current.status !== "failed") continue;
    try {
      const [written] = await writePrompts(bible, all, item.n, item.n, [item.n]);
      const cleaned = sanitizePrompt((written ?? "").trim());
      if (cleaned && !localCheck({ ...item, prompt: cleaned })) {
        out.set(item.n, { n: item.n, prompt: cleaned, status: "rewritten" });
      }
    } catch (error) {
      console.error(
        `[verify] line ${item.n} focused rewrite failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return items.map((i) => out.get(i.n) as VerifyResult);
}
