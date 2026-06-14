import { z } from 'zod';

// ============================================================
// WorldChangeParser — parses ---WORLD_CHANGES--- JSON blocks
// from AI-generated text using a three-tier fallback strategy.
// ============================================================

const SEPARATOR = '---WORLD_CHANGES---';

// ---- Zod Schemas ----

const NewCharacterSchema = z.object({
  name: z.string(),
  appearance: z.string().optional(),
  personality: z.string().optional(),
  background: z.string().optional(),
  abilities: z.string().optional(),
  faction: z.string().optional(),
  voiceStyle: z.string().optional(),
});

const UpdateCharacterSchema = z.object({
  name: z.string(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

const NewRelationshipSchema = z.object({
  characterA: z.string(),
  characterB: z.string(),
  type: z.string(),
  affinityChange: z.number().optional(),
  description: z.string().optional(),
});

const UpdateRelationshipSchema = z.object({
  characterA: z.string(),
  characterB: z.string(),
  type: z.string().optional(),
  affinityChange: z.number().optional(),
  description: z.string().optional(),
});

const NewEventSchema = z.object({
  name: z.string(),
  description: z.string(),
  participatingCharacters: z.array(z.string()).optional().default([]),
  impact: z.string().optional(),
  storyTimestamp: z.string().optional(),
});

const WorldChangeItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('new_character'), data: NewCharacterSchema }),
  z.object({ type: z.literal('update_character'), data: UpdateCharacterSchema }),
  z.object({ type: z.literal('new_relationship'), data: NewRelationshipSchema }),
  z.object({ type: z.literal('update_relationship'), data: UpdateRelationshipSchema }),
  z.object({ type: z.literal('new_event'), data: NewEventSchema }),
]);

const WorldChangesSchema = z.object({
  changes: z.array(WorldChangeItemSchema),
});

export type ParsedWorldChange = z.infer<typeof WorldChangeItemSchema>;

export interface WorldChangeParseResult {
  storyText: string;
  changes: ParsedWorldChange[] | null;
  parseError: boolean;
  noDetection: boolean;
  repaired: boolean;
  parseWarnings: string[];
}

// ---- JSON repair helpers ----

/**
 * Attempt to fix common LLM JSON generation errors:
 * - Trailing commas before ] or }
 * - Missing closing brackets (tries to balance)
 * - Control characters in strings
 */
function repairJson(raw: string): string {
  let s = raw.trim();

  // Remove trailing commas before closing brackets
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Remove control characters that break JSON parsing
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    // Allow standard JSON whitespace
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });

  // Attempt to balance brackets if unbalanced
  const openCurly = (s.match(/\{/g) || []).length;
  const closeCurly = (s.match(/\}/g) || []).length;
  const openSquare = (s.match(/\[/g) || []).length;
  const closeSquare = (s.match(/\]/g) || []).length;

  for (let i = 0; i < openCurly - closeCurly; i++) s += '}';
  for (let i = 0; i < openSquare - closeSquare; i++) s += ']';

  return s;
}

// ---- Parser ----

export class WorldChangeParser {
  /**
   * Parse the full AI response.
   * Returns storyText (the part before ---WORLD_CHANGES---) and
   * the parsed world changes (or null on failure).
   */
  parse(fullResponse: string): WorldChangeParseResult {
    const result: WorldChangeParseResult = {
      storyText: fullResponse,
      changes: null,
      parseError: false,
      noDetection: false,
      repaired: false,
      parseWarnings: [],
    };

    // Find the separator
    const separatorIdx = fullResponse.indexOf(SEPARATOR);
    if (separatorIdx === -1) {
      result.noDetection = true;
      return result;
    }

    // Split story text from JSON block
    result.storyText = fullResponse.slice(0, separatorIdx).trimEnd();
    const jsonPart = fullResponse.slice(separatorIdx + SEPARATOR.length).trim();

    if (!jsonPart) {
      result.noDetection = true;
      return result;
    }

    // Extract JSON object (find first { ... })
    const jsonStart = jsonPart.indexOf('{');
    if (jsonStart === -1) {
      result.parseError = true;
      return result;
    }
    const rawJson = jsonPart.slice(jsonStart);

    // Tier 1: Strict Zod parsing
    try {
      const parsed = JSON.parse(rawJson);
      const validated = WorldChangesSchema.safeParse(parsed);
      if (validated.success) {
        result.changes = validated.data.changes;
        return result;
      }
      result.parseWarnings.push('Strict validation failed, trying lenient');
    } catch {
      result.parseWarnings.push('JSON.parse failed, trying repair');
    }

    // Tier 2: Try lenient Zod parsing (partial schema — extract valid items)
    try {
      const parsed = JSON.parse(rawJson);
      const lenient = z.object({
        changes: z.array(z.unknown()).catch([]),
      }).safeParse(parsed);

      if (lenient.success) {
        const validItems: ParsedWorldChange[] = [];
        for (const item of lenient.data.changes) {
          const itemResult = WorldChangeItemSchema.safeParse(item);
          if (itemResult.success) {
            validItems.push(itemResult.data);
          } else {
            result.parseWarnings.push(`Skipped invalid change item: ${JSON.stringify(item)}`);
          }
        }
        if (validItems.length > 0) {
          result.changes = validItems;
          return result;
        }
      }
    } catch {
      // Fall through to tier 3
    }

    // Tier 3: JSON repair attempt
    const repairedJson = repairJson(rawJson);
    try {
      const parsed = JSON.parse(repairedJson);
      const validated = WorldChangesSchema.safeParse(parsed);
      if (validated.success) {
        result.changes = validated.data.changes;
        result.repaired = true;
        return result;
      }

      // Try lenient again on repaired
      const lenient = z.object({
        changes: z.array(z.unknown()).catch([]),
      }).safeParse(parsed);

      if (lenient.success) {
        const validItems: ParsedWorldChange[] = [];
        for (const item of lenient.data.changes) {
          const itemResult = WorldChangeItemSchema.safeParse(item);
          if (itemResult.success) {
            validItems.push(itemResult.data);
          }
        }
        if (validItems.length > 0) {
          result.changes = validItems;
          result.repaired = true;
          return result;
        }
      }
    } catch {
      // All tiers failed
    }

    // Tier 4: Graceful degradation
    result.parseError = true;
    return result;
  }
}

let instance: WorldChangeParser | null = null;

export function getWorldChangeParser(): WorldChangeParser {
  if (!instance) {
    instance = new WorldChangeParser();
  }
  return instance;
}
