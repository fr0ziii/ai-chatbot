import { tool } from "ai";
import { z } from "zod";

const confidenceEnum = z.enum(["high", "medium", "low"]);

export const finalAnswer = tool({
  description:
    "Provide the final answer to the user's question after completing research and analysis. This tool signals that you have gathered all necessary information and are ready to present your complete response. Use this when you have a comprehensive answer ready.",
  inputSchema: z.object({
    answer: z
      .string()
      .describe(
        "The complete, well-formatted answer to the user's question. Be thorough and clear."
      ),
    sources: z
      .array(z.string().url())
      .optional()
      .describe(
        "Optional array of source URLs that were used to formulate this answer"
      ),
    confidence: confidenceEnum
      .optional()
      .default("high")
      .describe(
        "Your confidence level in this answer: 'high' (well-supported by sources), 'medium' (partially supported), or 'low' (limited information available)"
      ),
  }),
  needsApproval: false,
  execute: async ({ answer, sources, confidence = "high" }) => {
    // Validate sources if provided
    const validatedSources: string[] = [];
    if (sources && sources.length > 0) {
      for (const source of sources) {
        try {
          new URL(source);
          validatedSources.push(source);
        } catch {
          // Skip invalid URLs
        }
      }
    }

    // Format the final response
    let formattedAnswer = answer;

    // Add sources section if available
    if (validatedSources.length > 0) {
      formattedAnswer += "\n\n**Sources:**\n";
      validatedSources.forEach((source, index) => {
        formattedAnswer += `${index + 1}. ${source}\n`;
      });
    }

    // Add confidence indicator if not high
    if (confidence === "medium") {
      formattedAnswer +=
        "\n\n*Note: This answer is based on partially available information.*";
    } else if (confidence === "low") {
      formattedAnswer +=
        "\n\n*Note: This answer is based on limited available information. Further research may be needed.*";
    }

    return {
      answer: formattedAnswer,
      sources: validatedSources.length > 0 ? validatedSources : undefined,
      confidence,
      completed: true,
    };
  },
});
