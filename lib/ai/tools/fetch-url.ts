import { tool } from "ai";
import { z } from "zod";

// Simple HTML to text conversion
function htmlToText(html: string): string {
  // Remove script and style tags with their content
  let text = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
  text = text.replace(
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
    ""
  );

  // Remove common boilerplate elements
  text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, "");
  text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, "");
  text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, "");
  text = text.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, "");

  // Replace common block elements with newlines
  text = text.replace(/<\/?(div|p|br|h[1-6]|li|tr|section|article)[^>]*>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  };

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, "g"), char);
  }

  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, "\n\n"); // Multiple newlines to double newline
  text = text.replace(/[ \t]+/g, " "); // Multiple spaces to single space
  text = text.trim();

  return text;
}

// Extract main content from HTML
function extractMainContent(html: string): string {
  // Try to find main content area
  const mainContentRegex =
    /<(?:main|article|div[^>]*class="[^"]*(?:content|main|article|post)[^"]*")[^>]*>([\s\S]*?)<\/(?:main|article|div)>/i;
  const match = html.match(mainContentRegex);

  if (match) {
    return htmlToText(match[1]);
  }

  // If no main content found, process the whole body
  const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/i;
  const bodyMatch = html.match(bodyRegex);

  if (bodyMatch) {
    return htmlToText(bodyMatch[1]);
  }

  // Fallback to the entire HTML
  return htmlToText(html);
}

// Extract title from HTML
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    return htmlToText(titleMatch[1]);
  }

  const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (h1Match) {
    return htmlToText(h1Match[1]);
  }

  return "Untitled";
}

export const fetchUrl = tool({
  description:
    "Fetch and extract text content from a URL. Use this tool to read web pages, articles, documentation, or any web content. The tool will extract the main text content and remove navigation, ads, and other boilerplate.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch content from"),
    extractMainContent: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Whether to extract only the main content area (default: true) or return all text content"
      ),
  }),
  needsApproval: false,
  execute: async ({ url, extractMainContent: shouldExtractMain = true }) => {
    try {
      // Validate URL
      const urlObj = new URL(url);

      // Basic security check - avoid fetching sensitive paths
      const suspiciousPaths = ["/admin", "/login", "/.env", "/config"];
      if (suspiciousPaths.some((path) => urlObj.pathname.includes(path))) {
        return {
          error: "Cannot fetch URLs from potentially sensitive paths",
          code: "FORBIDDEN_PATH",
        };
      }

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AI-Agent-Bot/1.0; +https://github.com/your-repo)",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          error: `Failed to fetch URL: ${response.status} ${response.statusText}`,
          code: response.status === 404 ? "NOT_FOUND" : "HTTP_ERROR",
          statusCode: response.status,
        };
      }

      // Check content type
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return {
          error: `Unsupported content type: ${contentType}. Only HTML and plain text are supported.`,
          code: "UNSUPPORTED_CONTENT_TYPE",
        };
      }

      const html = await response.text();

      // Extract title and content
      const title = extractTitle(html);
      let content = shouldExtractMain
        ? extractMainContent(html)
        : htmlToText(html);

      // Limit content length to avoid overwhelming the context
      const maxLength = 10000;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + "\n\n[Content truncated...]";
      }

      return {
        title,
        content,
        url,
        extractedAt: new Date().toISOString(),
        contentLength: content.length,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            error: "Request timeout - the URL took too long to respond (max 10 seconds)",
            code: "TIMEOUT",
          };
        }

        return {
          error: `Failed to fetch URL: ${error.message}`,
          code: "FETCH_FAILED",
        };
      }

      return {
        error: "Failed to fetch URL: Unknown error",
        code: "UNKNOWN_ERROR",
      };
    }
  },
});
