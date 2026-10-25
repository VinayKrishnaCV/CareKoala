export interface BoundaryMessage {
  id: string;
  speaker: "user" | "other";
  text: string;
}

const concernTypes = [
  "credential_request",
  "pressure_after_refusal",
  "assistance_related_coercion",
  "safe",
  "distress",
  "self_harm",
  "harassment",
  "hate_speech",
  "violence",
] as const;
const statuses = [
  "concern_detected",
  "no_clear_concern",
  "insufficient_context",
] as const;
const levels = ["none", "watch", "alert", "emergency"] as const;

export interface BoundaryConcern {
  type: (typeof concernTypes)[number];
  evidence_ids: string[];
  explanation: string;
}

export interface BoundaryAnalysis {
  status: (typeof statuses)[number];
  concerns: BoundaryConcern[];
  clarifying_question: string | null;
  score?: number | null;
  category?: string | null;
  level?: (typeof levels)[number] | null;
  contact_guardian?: boolean | null;
  windows?: number | null;
  model?: string | null;
  mock?: boolean | null;
}

interface AnalysisRequest {
  conversation_id: string;
  messages: readonly BoundaryMessage[];
  boundaries: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return (
    typeof value === "string" && values.some((entry: string) => entry === value)
  );
}

function parseConcern(value: unknown): BoundaryConcern {
  if (
    !isRecord(value) ||
    !includes(concernTypes, value.type) ||
    !Array.isArray(value.evidence_ids) ||
    !value.evidence_ids.every(
      (id: unknown): id is string => typeof id === "string",
    ) ||
    typeof value.explanation !== "string"
  ) {
    throw new Error("Invalid analysis concern");
  }
  return {
    type: value.type,
    evidence_ids: value.evidence_ids,
    explanation: value.explanation,
  };
}

export function parseAnalysis(value: unknown): BoundaryAnalysis {
  if (
    !isRecord(value) ||
    !includes(statuses, value.status) ||
    !Array.isArray(value.concerns)
  ) {
    throw new Error("Invalid analysis response");
  }
  if (
    value.clarifying_question !== undefined &&
    value.clarifying_question !== null &&
    typeof value.clarifying_question !== "string"
  ) {
    throw new Error("Invalid clarification");
  }
  const analysis: BoundaryAnalysis = {
    status: value.status,
    concerns: value.concerns.map(
      (concern: unknown): BoundaryConcern => parseConcern(concern),
    ),
    clarifying_question: value.clarifying_question ?? null,
  };
  if (value.score === null) {
    analysis.score = null;
  } else if (value.score !== undefined) {
    if (
      typeof value.score !== "number" ||
      !Number.isInteger(value.score) ||
      value.score < 0 ||
      value.score > 10
    )
      throw new Error("Invalid score");
    analysis.score = value.score;
  }
  if (value.category === null) {
    analysis.category = null;
  } else if (value.category !== undefined) {
    if (typeof value.category !== "string") throw new Error("Invalid category");
    analysis.category = value.category;
  }
  if (value.level === null) {
    analysis.level = null;
  } else if (value.level !== undefined) {
    if (!includes(levels, value.level)) throw new Error("Invalid level");
    analysis.level = value.level;
  }
  if (value.contact_guardian === null) {
    analysis.contact_guardian = null;
  } else if (value.contact_guardian !== undefined) {
    if (typeof value.contact_guardian !== "boolean")
      throw new Error("Invalid guardian decision");
    analysis.contact_guardian = value.contact_guardian;
  }
  if (value.windows === null) {
    analysis.windows = null;
  } else if (value.windows !== undefined) {
    if (
      typeof value.windows !== "number" ||
      !Number.isInteger(value.windows) ||
      value.windows < 0
    )
      throw new Error("Invalid window count");
    analysis.windows = value.windows;
  }
  if (value.model === null) {
    analysis.model = null;
  } else if (value.model !== undefined) {
    if (typeof value.model !== "string") throw new Error("Invalid model field");
    analysis.model = value.model;
  }
  if (value.mock === null) {
    analysis.mock = null;
  } else if (value.mock !== undefined) {
    if (typeof value.mock !== "boolean") throw new Error("Invalid mode field");
    analysis.mock = value.mock;
  }
  return analysis;
}

export async function analyzeVisibleConversation(
  conversationId: string,
  messages: readonly BoundaryMessage[],
  boundaries: readonly string[] = [],
): Promise<BoundaryAnalysis> {
  const payload: AnalysisRequest = {
    conversation_id: conversationId,
    messages,
    boundaries,
  };
  const response: Response = await fetch("http://127.0.0.1:8765/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Analysis unavailable");
  const value: unknown = await response.json();
  return parseAnalysis(value);
}
