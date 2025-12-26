import { tool } from "ai";
import { z } from "zod";

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilySearchResult[];
}

export const webSearch = tool({
  description:
    "Search the web for information using a search API. Use this tool to find current information, facts, news, or answers to questions that require up-to-date knowledge. Returns a list of search results with titles, URLs, and content snippets.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The search query to find relevant information on the web"),
    maxResults: z
      .number()
      .optional()
      .default(5)
      .describe(
        "Maximum number of search results to return (default: 5, max: 10)"
      ),
  }),
  needsApproval: false,
  execute: async ({ query, maxResults = 5 }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return {
        error:
          "Web search is not configured. Please set TAVILY_API_KEY in your environment variables.",
        code: "MISSING_API_KEY",
      };
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(maxResults, 10),
          include_answer: false,
          include_raw_content: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          error: `Search API returned error: ${response.status} ${response.statusText}`,
          code: "API_ERROR",
          details: errorText,
        };
      }

      const data = (await response.json()) as TavilyResponse;

      if (!data.results || data.results.length === 0) {
        return {
          results: [],
          message: `No results found for query: "${query}"`,
        };
      }

      const results = data.results.map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.published_date,
      }));

      return {
        results,
        query,
        count: results.length,
      };
    } catch (error) {
      return {
        error: `Failed to perform web search: ${error instanceof Error ? error.message : "Unknown error"}`,
        code: "SEARCH_FAILED",
      };
    }
  },
});
