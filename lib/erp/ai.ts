import "server-only";
import type { Recommendation } from "./po-engine";

/** True when a Claude API key is configured (enables the LLM-backed panel). */
export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const REC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          detail: { type: "string" },
          action: { type: "string" },
          sku_code: { type: "string" },
        },
        required: ["severity", "title", "detail", "action", "sku_code"],
      },
    },
  },
  required: ["recommendations"],
} as const;

/**
 * Ask Claude for procurement recommendations from the stock/demand context.
 * Returns null if no API key is set or the call fails — callers fall back to
 * the heuristic engine (`smartRecommendations`).
 */
export async function aiRecommendations(context: unknown): Promise<Recommendation[] | null> {
  if (!aiAvailable()) return null;
  try {
    // Dynamic import keeps the build working even if the SDK isn't installed.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const system =
      "You are a procurement analyst for a bike-parts distributor's ERP. " +
      "Given a JSON snapshot of stock levels, demand over a reference window, costs and vendor linkage, " +
      "produce concise, prioritised purchasing recommendations a purchase manager can act on today. " +
      "Be specific and quantitative (cite SKU codes and numbers). Cover: urgent reorders/stockouts, " +
      "fast movers to buffer, overstock/dead stock to pause, margin or vendor-data gaps. " +
      "Order by severity (high first). Return at most 8 recommendations. " +
      "When a recommendation is portfolio-wide rather than about one SKU, set sku_code to an empty string.";

    // Cast via unknown: the API accepts adaptive thinking + output_config even
    // when the installed SDK's static types lag the API surface.
    const params = {
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: REC_SCHEMA },
      },
      system,
      messages: [
        {
          role: "user",
          content: `Inventory & demand snapshot:\n\n${JSON.stringify(context, null, 2)}`,
        },
      ],
    };
    const msg = (await client.messages.create(
      params as unknown as Parameters<typeof client.messages.create>[0],
    )) as { content: Array<{ type: string; text?: string }> };

    const text = msg.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text as string)
      .join("");
    if (!text) return null;

    const parsed = JSON.parse(text) as { recommendations?: Recommendation[] };
    return Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 8) : null;
  } catch (e) {
    console.error("aiRecommendations failed; falling back to heuristic:", e);
    return null;
  }
}
