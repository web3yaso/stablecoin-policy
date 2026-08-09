/** Confirms the Anthropic key and the web_search tool work end-to-end. */
import "../env.js";
import Anthropic from "../../lib/openai-llm.js";

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const client = new Anthropic({ apiKey: key });
  console.log("[smoke] calling Claude with web_search tool...");
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 2,
      },
    ],
    messages: [
      {
        role: "user",
        content:
          "Find the latest official U.S. federal payment-stablecoin rulemaking. In one sentence, identify the authority and source URL. Don't return JSON, just plain text.",
      },
    ],
  });
  for (const block of msg.content) {
    if (block.type === "text") console.log("[smoke] response:", block.text);
  }
  console.log(
    `[smoke] usage: in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`,
  );
}

main().catch((e) => {
  console.error("[smoke] failed:", e.message);
  process.exit(1);
});
