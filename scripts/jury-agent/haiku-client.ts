/**
 * haiku-client.ts
 *
 * Minimal Anthropic API client for calling Claude Haiku.
 * No SDK dependency — raw fetch with proper headers.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Call Claude Haiku with a single user prompt.
 * Returns the raw text of the first content block.
 */
export async function callHaiku(
  apiKey: string,
  prompt: string,
  maxTokens = 100
): Promise<string> {
  const messages: Message[] = [{ role: "user", content: prompt }];

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Anthropic API error ${response.status}: ${errorBody}`
    );
  }

  const data = (await response.json()) as AnthropicResponse;

  const textBlock = data.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("No text content in Anthropic API response");
  }

  return textBlock.text.trim();
}

/**
 * Build the resolution prompt for a prediction market question.
 */
export function buildResolutionPrompt(question: string): string {
  return (
    `You are a prediction market resolver. The market question is: '${question}'. ` +
    `Based on publicly available information as of today, has this event occurred? ` +
    `Respond with exactly YES or NO, followed by a one-sentence explanation.`
  );
}

/**
 * Parse a Haiku response into an outcome integer.
 * YES → 0, NO → 1
 * Throws if the response cannot be parsed.
 */
export function parseOutcome(response: string): { outcome: number; explanation: string } {
  const upper = response.toUpperCase().trimStart();

  if (upper.startsWith("YES")) {
    const explanation = response.slice(3).replace(/^[.,:\s]+/, "").trim();
    return { outcome: 0, explanation };
  }

  if (upper.startsWith("NO")) {
    const explanation = response.slice(2).replace(/^[.,:\s]+/, "").trim();
    return { outcome: 1, explanation };
  }

  throw new Error(
    `Cannot parse Haiku response as YES/NO: "${response}"`
  );
}
