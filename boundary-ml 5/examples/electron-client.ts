export type BoundaryMessage = {
  id: string;
  speaker: "user" | "other";
  text: string;
};

export type BoundaryAnalysis = {
  status: "concern_detected" | "no_clear_concern" | "insufficient_context";
  concerns: Array<{
    type:
      | "credential_request"
      | "pressure_after_refusal"
      | "assistance_related_coercion";
    evidence_ids: string[];
    explanation: string;
  }>;
  clarifying_question: string | null;
};

/**
 * Call this after local OCR has produced user-visible, editable messages.
 * Keep screenshot pixels inside Electron; send only normalized text.
 */
export async function analyzeVisibleConversation(
  conversationId: string,
  messages: BoundaryMessage[],
  boundaries: string[] = [],
): Promise<BoundaryAnalysis> {
  const response = await fetch("http://127.0.0.1:8765/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversation_id: conversationId,
      messages,
      boundaries,
    }),
  });

  if (!response.ok) {
    throw new Error("Boundary analysis is temporarily unavailable");
  }
  return (await response.json()) as BoundaryAnalysis;
}

