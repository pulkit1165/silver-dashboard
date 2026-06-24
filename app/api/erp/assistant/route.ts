import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/erp/session";
import { aiAvailable } from "@/lib/erp/ai";
import { logActivity } from "@/lib/erp/activity";
import {
  ASSISTANT_MODEL, RUN_SQL_TOOL, buildSystemPrompt, runReadOnlySql,
} from "@/lib/erp/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // allow long multi-step analytical answers

type ChatMsg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!aiAvailable()) {
    return NextResponse.json(
      { ok: false, error: "The AI assistant isn't configured yet — an ANTHROPIC_API_KEY is required." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m: ChatMsg) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m: ChatMsg) => ({ role: m.role, content: m.content }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ ok: false, error: "No question provided." }, { status: 400 });
  }

  const lastQuestion = String(history[history.length - 1].content).slice(0, 500);
  // Audit + live feed: record who asked what (best-effort).
  void logActivity({
    actor: user.name, actorRole: user.role, action: "assistant.query",
    entity: "assistant", summary: `Asked the AI: "${lastQuestion}"`,
  });

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const system = await buildSystemPrompt();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      // Conversation we extend with assistant turns + tool results as the loop runs.
      const messages: Array<{ role: string; content: unknown }> = [...history];
      try {
        for (let round = 0; round < 8; round++) {
          // Cast: the installed SDK's static types lag adaptive thinking / effort.
          const params = {
            model: ASSISTANT_MODEL,
            max_tokens: 8000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools: [RUN_SQL_TOOL],
            messages,
          } as unknown as Parameters<typeof client.messages.stream>[0];

          const s = client.messages.stream(params);
          s.on("text", (delta: string) => send({ type: "text", delta }));
          const msg = await s.finalMessage();

          const toolUses = (msg.content as unknown as Array<Record<string, unknown>>).filter((b) => b.type === "tool_use");
          if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break; // final answer produced

          // Echo the assistant turn verbatim (preserves thinking blocks for the next call).
          messages.push({ role: "assistant", content: msg.content });
          const results: Array<Record<string, unknown>> = [];
          for (const tu of toolUses) {
            const sqlStr = String((tu.input as { sql?: string })?.sql ?? "");
            send({ type: "sql", sql: sqlStr });
            const res = await runReadOnlySql(sqlStr);
            if (res.ok) {
              send({ type: "rows", rowCount: res.rowCount, truncated: res.truncated, sample: res.rows.slice(0, 50) });
              results.push({
                type: "tool_result", tool_use_id: tu.id,
                content: JSON.stringify({ rowCount: res.rowCount, truncated: res.truncated, rows: res.rows }).slice(0, 60000),
              });
            } else {
              send({ type: "sql_error", error: res.error });
              results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Error: ${res.error}` });
            }
          }
          messages.push({ role: "user", content: results });
        }
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: String((e as Error)?.message || e).slice(0, 400) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
