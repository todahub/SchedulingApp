import type { Label, LabeledComment } from "@/lib/comment-labeler";

const INTERPRETATION_RELATIONS = [
  "applies_to",
  "modifies",
  "contrast_with",
  "exception_to",
  "residual_of",
  "condition_for",
] as const;

const INTERPRETATION_CONFIDENCES = ["high", "medium", "low"] as const;

export type InterpretationRelation = (typeof INTERPRETATION_RELATIONS)[number];

export type InterpretationConfidence = (typeof INTERPRETATION_CONFIDENCES)[number];

export type LlmInterpretationInputToken = {
  index: number;
  text: string;
  label: Label;
  start: number;
  end: number;
  normalizedText?: string;
};

export type LlmInterpretationInput = {
  originalText: string;
  tokens: LlmInterpretationInputToken[];
};

type BaseTokenLink = {
  confidence: InterpretationConfidence;
  note?: string;
};

export type AppliesToTokenLink = BaseTokenLink & {
  relation: "applies_to";
  targetTokenIndexes: number[];
  availabilityTokenIndexes: number[];
  modifierTokenIndexes?: number[];
};

export type StructuralTokenLink = BaseTokenLink & {
  relation: Exclude<InterpretationRelation, "applies_to">;
  sourceTokenIndexes: number[];
  targetTokenIndexes: number[];
  markerTokenIndexes?: number[];
};

export type TokenLink = AppliesToTokenLink | StructuralTokenLink;

export type LlmInterpretationOutput = {
  links: TokenLink[];
  ambiguities?: string[];
};

export class AvailabilityInterpretationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvailabilityInterpretationParseError";
  }
}

export function toLlmInterpretationInput(labeledComment: LabeledComment): LlmInterpretationInput {
  return {
    originalText: labeledComment.originalText,
    tokens: labeledComment.tokens.map((token, index) => ({
      index,
      text: token.text,
      label: token.label,
      start: token.start,
      end: token.end,
      ...(typeof token.normalizedText === "string" ? { normalizedText: token.normalizedText } : {}),
    })),
  };
}

export function buildAvailabilityInterpretationMessages(input: LlmInterpretationInput): { system: string; user: string } {
  return {
    system: [
      "You are a constrained relation interpreter for pre-labeled scheduling comment tokens.",
      "Your job is relation interpretation only. Do not detect, retokenize, or relabel tokens.",
      "Respect the provided token list exactly.",
      "",
      "Allowed work:",
      "- Link target-like tokens to availability tokens.",
      "- Attach modifier tokens such as uncertainty, contrast, residual, exception, and condition markers to the correct tokens.",
      "- Resolve precedence between broad scope and specific scope only when the needed tokens already exist in the input.",
      "",
      "Do not:",
      "- Do not create any new date, weekday, time-of-day, target, or availability value.",
      '- Do not turn "金曜" into a concrete calendar date.',
      '- Do not turn "5日" into a different date.',
      '- Do not turn "行けるかも" into a stronger yes.',
      '- Do not turn "無理ではない" into a definitive yes.',
      "- Do not strengthen or weaken certainty, polarity, or scope.",
      '- Do not invent merged spans such as "5日午前"; use existing token indexes instead.',
      '- Do not use the "modifies" relation in this phase.',
      "- Do not ignore labels and reinterpret the sentence freely.",
      "- Do not answer in prose.",
      "- Return JSON only. No markdown. No code fences.",
      "",
      "If the relation is ambiguous:",
      '- Use "low" confidence.',
      '- Add a short explanation to "ambiguities".',
      "- Prefer unresolved over invented.",
      "",
      "Output schema:",
      "{",
      '  "links": [',
      "    {",
      '      "relation": "applies_to",',
      '      "targetTokenIndexes": [0],',
      '      "availabilityTokenIndexes": [2],',
      '      "modifierTokenIndexes": [3],',
      '      "confidence": "high",',
      '      "note": "optional short note"',
      "    },",
      "    {",
      '      "relation": "contrast_with" | "exception_to" | "residual_of" | "condition_for",',
      '      "sourceTokenIndexes": [4],',
      '      "targetTokenIndexes": [5],',
      '      "markerTokenIndexes": [6],',
      '      "confidence": "medium",',
      '      "note": "optional short note"',
      "    }",
      "  ],",
      '  "ambiguities": ["optional short note"]',
      "}",
      "",
      "Index rules:",
      "- Every index must refer to an existing input token.",
      '- For "applies_to", "availabilityTokenIndexes" must point only to availability tokens already present in the input.',
      '- For "applies_to", "targetTokenIndexes" should point to target tokens when present, or existing scope tokens when the clause is residual, exception, or all-scope.',
      "- Use the smallest token groups that preserve the observed relation.",
      '- If nothing can be linked safely, return {"links":[],"ambiguities":["..."]}.',
    ].join("\n"),
    user: [
      "Interpret the provided token sequence.",
      "Focus on:",
      "- target and availability pairing",
      "- modifier attachment",
      "- contrast, residual, exception, and condition handling",
      "- precedence between specific and broad scope",
      "",
      "Representative example 1:",
      '- 0 | "5日" | target_date',
      '- 1 | "は" | particle_topic',
      '- 2 | "無理" | availability_negative',
      '- 3 | "、" | punctuation_boundary',
      '- 4 | "あとは" | scope_residual',
      '- 5 | "いける" | availability_positive',
      "Expected JSON:",
      '{"links":[{"relation":"applies_to","targetTokenIndexes":[0],"availabilityTokenIndexes":[2],"confidence":"high"},{"relation":"applies_to","targetTokenIndexes":[4],"availabilityTokenIndexes":[5],"confidence":"medium"},{"relation":"residual_of","sourceTokenIndexes":[4],"targetTokenIndexes":[0],"markerTokenIndexes":[3],"confidence":"medium"}]}',
      "",
      "Representative example 2:",
      '- 0 | "平日" | target_weekday_group',
      '- 1 | "は" | particle_topic',
      '- 2 | "無理" | availability_negative',
      '- 3 | "だけど" | conjunction_contrast',
      '- 4 | "土日" | target_weekday_group',
      '- 5 | "は" | particle_topic',
      '- 6 | "いける" | availability_positive',
      "Expected JSON:",
      '{"links":[{"relation":"applies_to","targetTokenIndexes":[0],"availabilityTokenIndexes":[2],"confidence":"high"},{"relation":"applies_to","targetTokenIndexes":[4],"availabilityTokenIndexes":[6],"confidence":"high"},{"relation":"contrast_with","sourceTokenIndexes":[0,2],"targetTokenIndexes":[4,6],"markerTokenIndexes":[3],"confidence":"high"}]}',
      "",
      `Original text: ${JSON.stringify(input.originalText)}`,
      "Input tokens:",
      formatInputTokens(input),
      "",
      "Return JSON only.",
    ].join("\n"),
  };
}

export function buildAvailabilityInterpretationPrompt(input: LlmInterpretationInput): string {
  const { system, user } = buildAvailabilityInterpretationMessages(input);

  return [`[system]`, system, "", `[user]`, user].join("\n");
}

export function parseAvailabilityInterpretationResponse(
  jsonText: string,
  input: LlmInterpretationInput,
): LlmInterpretationOutput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AvailabilityInterpretationParseError("Availability interpretation response must be valid JSON.");
  }

  return validateAvailabilityInterpretationOutput(parsed, input);
}

export function validateAvailabilityInterpretationOutput(
  value: unknown,
  input: LlmInterpretationInput,
): LlmInterpretationOutput {
  if (!isRecord(value)) {
    throw new AvailabilityInterpretationParseError("Availability interpretation output must be an object.");
  }

  if (!Array.isArray(value.links)) {
    throw new AvailabilityInterpretationParseError("Availability interpretation output must include a links array.");
  }

  const links = value.links.map((linkValue, index) => parseLink(linkValue, input, `links[${index}]`));
  const ambiguities = parseOptionalStrings(value.ambiguities, "ambiguities");

  return {
    links,
    ...(ambiguities.length > 0 ? { ambiguities } : {}),
  };
}

function parseLink(value: unknown, input: LlmInterpretationInput, path: string): TokenLink {
  if (!isRecord(value)) {
    throw new AvailabilityInterpretationParseError(`${path} must be an object.`);
  }

  const relation = parseRelation(value.relation, `${path}.relation`);
  const confidence = parseConfidence(value.confidence, `${path}.confidence`);
  const note = parseOptionalNote(value.note, `${path}.note`);

  if (relation === "applies_to") {
    const targetTokenIndexes = parseIndexList(value.targetTokenIndexes, input, `${path}.targetTokenIndexes`, {
      requireTargetLikeLabels: true,
    });
    const availabilityTokenIndexes = parseIndexList(value.availabilityTokenIndexes, input, `${path}.availabilityTokenIndexes`, {
      requireAvailabilityLabels: true,
    });
    const modifierTokenIndexes =
      value.modifierTokenIndexes === undefined
        ? undefined
        : parseIndexList(value.modifierTokenIndexes, input, `${path}.modifierTokenIndexes`, {
            allowEmpty: true,
          });

    assertAllowedLabels(
      modifierTokenIndexes ?? [],
      input,
      `${path}.modifierTokenIndexes`,
      isSemanticModifierLabel,
      "semantic modifier tokens",
    );

    assertDisjointIndexGroups(
      [
        { fieldName: `${path}.targetTokenIndexes`, indexes: targetTokenIndexes },
        { fieldName: `${path}.availabilityTokenIndexes`, indexes: availabilityTokenIndexes },
        { fieldName: `${path}.modifierTokenIndexes`, indexes: modifierTokenIndexes ?? [] },
      ],
      path,
    );

    return {
      relation,
      targetTokenIndexes,
      availabilityTokenIndexes,
      ...(modifierTokenIndexes && modifierTokenIndexes.length > 0 ? { modifierTokenIndexes } : {}),
      confidence,
      ...(note ? { note } : {}),
    };
  }

  if (relation === "modifies") {
    throw new AvailabilityInterpretationParseError(`${path}.relation must not be "modifies" in this phase.`);
  }

  const sourceTokenIndexes = parseIndexList(value.sourceTokenIndexes, input, `${path}.sourceTokenIndexes`);
  const targetTokenIndexes = parseIndexList(value.targetTokenIndexes, input, `${path}.targetTokenIndexes`);
  const markerTokenIndexes =
    value.markerTokenIndexes === undefined
      ? undefined
      : parseIndexList(value.markerTokenIndexes, input, `${path}.markerTokenIndexes`, {
          allowEmpty: true,
        });

  switch (relation) {
    case "contrast_with":
      if (!markerTokenIndexes || markerTokenIndexes.length === 0) {
        throw new AvailabilityInterpretationParseError(`${path}.markerTokenIndexes is required for contrast_with.`);
      }

      assertAllowedLabels(
        markerTokenIndexes,
        input,
        `${path}.markerTokenIndexes`,
        isContrastMarkerLabel,
        "contrast markers",
      );

      assertContainsAllowedLabel(
        sourceTokenIndexes,
        input,
        `${path}.sourceTokenIndexes`,
        isAvailabilityLabel,
        "at least one availability token",
      );
      assertContainsAllowedLabel(
        targetTokenIndexes,
        input,
        `${path}.targetTokenIndexes`,
        isAvailabilityLabel,
        "at least one availability token",
      );
      break;
    case "exception_to":
      assertAllowedLabels(
        sourceTokenIndexes,
        input,
        `${path}.sourceTokenIndexes`,
        isScopeExceptionLabel,
        "scope_exception tokens",
      );
      assertAllowedLabels(
        targetTokenIndexes,
        input,
        `${path}.targetTokenIndexes`,
        isTargetLabel,
        "target tokens",
      );

      if (markerTokenIndexes && markerTokenIndexes.length > 0) {
        throw new AvailabilityInterpretationParseError(`${path}.markerTokenIndexes must not be provided for exception_to.`);
      }
      break;
    case "residual_of":
      assertAllowedLabels(
        sourceTokenIndexes,
        input,
        `${path}.sourceTokenIndexes`,
        isScopeResidualLabel,
        "scope_residual tokens",
      );
      assertAllowedLabels(
        targetTokenIndexes,
        input,
        `${path}.targetTokenIndexes`,
        isTargetLabel,
        "target tokens",
      );

      if (targetTokenIndexes.some((tokenIndex) => tokenIndex >= Math.min(...sourceTokenIndexes))) {
        throw new AvailabilityInterpretationParseError(
          `${path}.targetTokenIndexes must reference only targets that appear before the residual scope token.`,
        );
      }

      if (markerTokenIndexes && markerTokenIndexes.length > 0) {
        assertAllowedLabels(
          markerTokenIndexes,
          input,
          `${path}.markerTokenIndexes`,
          isResidualMarkerLabel,
          "residual boundary markers",
        );
      }
      break;
    case "condition_for":
      if (!markerTokenIndexes || markerTokenIndexes.length === 0) {
        throw new AvailabilityInterpretationParseError(`${path}.markerTokenIndexes is required for condition_for.`);
      }

      assertAllowedLabels(
        sourceTokenIndexes,
        input,
        `${path}.sourceTokenIndexes`,
        isTargetLabel,
        "target tokens",
      );
      assertAllowedLabels(
        targetTokenIndexes,
        input,
        `${path}.targetTokenIndexes`,
        isAvailabilityLabel,
        "availability tokens",
      );
      assertAllowedLabels(
        markerTokenIndexes,
        input,
        `${path}.markerTokenIndexes`,
        isConditionMarkerLabel,
        "condition markers",
      );
      break;
  }

  assertDisjointIndexGroups(
    [
      { fieldName: `${path}.sourceTokenIndexes`, indexes: sourceTokenIndexes },
      { fieldName: `${path}.targetTokenIndexes`, indexes: targetTokenIndexes },
      { fieldName: `${path}.markerTokenIndexes`, indexes: markerTokenIndexes ?? [] },
    ],
    path,
  );

  return {
    relation,
    sourceTokenIndexes,
    targetTokenIndexes,
    ...(markerTokenIndexes && markerTokenIndexes.length > 0 ? { markerTokenIndexes } : {}),
    confidence,
    ...(note ? { note } : {}),
  };
}

function parseRelation(value: unknown, path: string): InterpretationRelation {
  if (typeof value !== "string" || !INTERPRETATION_RELATIONS.includes(value as InterpretationRelation)) {
    throw new AvailabilityInterpretationParseError(
      `${path} must be one of ${INTERPRETATION_RELATIONS.join(", ")}.`,
    );
  }

  return value as InterpretationRelation;
}

function parseConfidence(value: unknown, path: string): InterpretationConfidence {
  if (typeof value !== "string" || !INTERPRETATION_CONFIDENCES.includes(value as InterpretationConfidence)) {
    throw new AvailabilityInterpretationParseError(
      `${path} must be one of ${INTERPRETATION_CONFIDENCES.join(", ")}.`,
    );
  }

  return value as InterpretationConfidence;
}

function parseIndexList(
  value: unknown,
  input: LlmInterpretationInput,
  path: string,
  options: {
    allowEmpty?: boolean;
    requireAvailabilityLabels?: boolean;
    requireTargetLikeLabels?: boolean;
  } = {},
): number[] {
  if (!Array.isArray(value)) {
    throw new AvailabilityInterpretationParseError(`${path} must be an array of token indexes.`);
  }

  const indexes = value.map((indexValue, index) => {
    if (!Number.isInteger(indexValue)) {
      throw new AvailabilityInterpretationParseError(`${path}[${index}] must be an integer token index.`);
    }

    const tokenIndex = Number(indexValue);

    if (tokenIndex < 0 || tokenIndex >= input.tokens.length) {
      throw new AvailabilityInterpretationParseError(
        `${path}[${index}] is out of range for ${input.tokens.length} input tokens.`,
      );
    }

    return tokenIndex;
  });

  const normalizedIndexes = [...new Set(indexes)].sort((left, right) => left - right);

  if (!options.allowEmpty && normalizedIndexes.length === 0) {
    throw new AvailabilityInterpretationParseError(`${path} must contain at least one token index.`);
  }

  if (
    options.requireAvailabilityLabels &&
    normalizedIndexes.some((tokenIndex) => !isAvailabilityLabel(input.tokens[tokenIndex]!.label))
  ) {
    throw new AvailabilityInterpretationParseError(`${path} must reference only availability tokens.`);
  }

  if (
    options.requireTargetLikeLabels &&
    normalizedIndexes.some((tokenIndex) => !isTargetLikeLabel(input.tokens[tokenIndex]!.label))
  ) {
    throw new AvailabilityInterpretationParseError(
      `${path} must reference target tokens or scope tokens already present in the input.`,
    );
  }

  return normalizedIndexes;
}

function parseOptionalStrings(value: unknown, path: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new AvailabilityInterpretationParseError(`${path} must be an array of strings.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new AvailabilityInterpretationParseError(`${path}[${index}] must be a non-empty string.`);
    }

    return entry.trim();
  });
}

function parseOptionalNote(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AvailabilityInterpretationParseError(`${path} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function assertDisjointIndexGroups(
  groups: Array<{
    fieldName: string;
    indexes: number[];
  }>,
  path: string,
) {
  const seenByIndex = new Map<number, string>();

  for (const group of groups) {
    for (const tokenIndex of group.indexes) {
      const existingField = seenByIndex.get(tokenIndex);

      if (existingField) {
        throw new AvailabilityInterpretationParseError(
          `${path} reuses token index ${tokenIndex} in both ${existingField} and ${group.fieldName}.`,
        );
      }

      seenByIndex.set(tokenIndex, group.fieldName);
    }
  }
}

function isAvailabilityLabel(label: Label) {
  return label.startsWith("availability_");
}

function isTargetLikeLabel(label: Label) {
  return label.startsWith("target_") || label.startsWith("scope_");
}

function isTargetLabel(label: Label) {
  return label.startsWith("target_");
}

function isSemanticModifierLabel(label: Label) {
  return label === "uncertainty_marker" || label === "desire_marker" || label === "hypothetical_marker" || label === "emphasis_marker";
}

function isContrastMarkerLabel(label: Label) {
  return label === "conjunction_contrast";
}

function isScopeResidualLabel(label: Label) {
  return label === "scope_residual";
}

function isScopeExceptionLabel(label: Label) {
  return label === "scope_exception";
}

function isResidualMarkerLabel(label: Label) {
  return label === "punctuation_boundary" || label === "sentence_boundary" || label === "conjunction_parallel";
}

function isConditionMarkerLabel(label: Label) {
  return label === "conditional_marker" || label === "particle_condition";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertAllowedLabels(
  indexes: number[],
  input: LlmInterpretationInput,
  path: string,
  predicate: (label: Label) => boolean,
  expectedDescription: string,
) {
  if (indexes.some((tokenIndex) => !predicate(input.tokens[tokenIndex]!.label))) {
    throw new AvailabilityInterpretationParseError(`${path} must reference only ${expectedDescription}.`);
  }
}

function assertContainsAllowedLabel(
  indexes: number[],
  input: LlmInterpretationInput,
  path: string,
  predicate: (label: Label) => boolean,
  expectedDescription: string,
) {
  if (!indexes.some((tokenIndex) => predicate(input.tokens[tokenIndex]!.label))) {
    throw new AvailabilityInterpretationParseError(`${path} must include ${expectedDescription}.`);
  }
}

function formatInputTokens(input: LlmInterpretationInput) {
  if (input.tokens.length === 0) {
    return "- (no tokens)";
  }

  return input.tokens
    .map((token) =>
      [
        `- ${token.index} | ${JSON.stringify(token.text)} | ${token.label} | span=${token.start}-${token.end}`,
        typeof token.normalizedText === "string" ? ` | normalized=${JSON.stringify(token.normalizedText)}` : "",
      ].join(""),
    )
    .join("\n");
}
