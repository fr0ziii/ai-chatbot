import { generateText, tool } from "ai";
import { z } from "zod";
import { gateway } from "@ai-sdk/gateway";

const analysisTypeEnum = z.enum(["summarize", "extract_facts", "find_answers"]);

export const analyzeContent = tool({
  description:
    "Analyze or process large amounts of text content. Use this tool to summarize articles, extract key facts, or find specific information within fetched content. This helps process content that might be too large for the main context window.",
  inputSchema: z.object({
    content: z
      .string()
      .describe("The text content to analyze (e.g., from a fetched webpage)"),
    analysisType: analysisTypeEnum.describe(
      "Type of analysis: 'summarize' for a summary, 'extract_facts' for key facts and data points, 'find_answers' to search for specific information"
    ),
    query: z
      .string()
      .optional()
      .describe(
        "Optional query or question - required for 'find_answers' type, ignored for others"
      ),
  }),
  needsApproval: false,
  execute: async ({ content, analysisType, query }) => {
    if (analysisType === "find_answers" && !query) {
      return {
        error:
          "Query parameter is required when analysisType is 'find_answers'",
        code: "MISSING_QUERY",
      };
    }

    try {
      // Use a fast, efficient model for analysis
      const model = gateway.languageModel("anthropic/claude-haiku-4.5");

      // Build the analysis prompt based on type
      let systemPrompt = "";
      let userPrompt = "";

      switch (analysisType) {
        case "summarize":
          systemPrompt =
            "You are a helpful assistant that creates concise, accurate summaries. Focus on the main points and key information.";
          userPrompt = `Please provide a clear, concise summary of the following content:\n\n${content}`;
          break;

        case "extract_facts":
          systemPrompt =
            "You are a helpful assistant that extracts key facts, data points, and important information from text. Present information in a structured, easy-to-read format.";
          userPrompt = `Please extract the key facts, data points, and important information from the following content. Present them in a clear, structured format:\n\n${content}`;
          break;

        case "find_answers":
          systemPrompt =
            "You are a helpful assistant that finds specific information in text to answer questions. Be precise and cite relevant information from the content.";
          userPrompt = `Based on the following content, please answer this question: "${query}"\n\nContent:\n${content}\n\nIf the content doesn't contain information to answer the question, clearly state that.`;
          break;
      }

      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
      });

      // Extract key points from the analysis
      const keyPoints = result.text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .slice(0, 5); // Take first 5 non-empty lines as key points

      return {
        analysis: result.text,
        keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
        analysisType,
        query: query || undefined,
        confidence: "high" as const,
      };
    } catch (error) {
      return {
        error: `Failed to analyze content: ${error instanceof Error ? error.message : "Unknown error"}`,
        code: "ANALYSIS_FAILED",
      };
    }
  },
});
