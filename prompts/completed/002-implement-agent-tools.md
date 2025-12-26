<objective>
Implement a new set of web-focused tools designed for agentic workflows, replacing the existing chatbot tools.

Delete the old tools (getWeather, createDocument, updateDocument, requestSuggestions) and create new tools optimized for autonomous agent execution with multi-step reasoning.
</objective>

<context>
This project is being refactored from a chatbot to an agent template. The previous prompt (001) established the ToolLoopAgent architecture. Now we need tools designed for agentic use cases.

The agent's primary use case is a general-purpose assistant with web capabilities, serving as an open-source template for building AI agents.

Read these files to understand existing patterns:
@lib/ai/tools/get-weather.ts (to understand current tool structure - then delete)
@lib/ai/tools/create-document.ts (to understand current tool structure - then delete)
@lib/ai/tools/update-document.ts (to understand current tool structure - then delete)
@lib/ai/tools/request-suggestions.ts (to understand current tool structure - then delete)
@lib/ai/tools/index.ts (main export file)
@lib/ai/agent.ts (new agent definition from prompt 001)
</context>

<ai_sdk_tool_patterns>
Tool definition with AI SDK v6:
```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const myTool = tool({
  description: 'Clear description of what this tool does and when to use it',
  inputSchema: z.object({
    param1: z.string().describe('Description for the model'),
    param2: z.number().optional().describe('Optional parameter'),
  }),
  execute: async ({ param1, param2 }) => {
    // Tool logic
    return { result: 'data' };
  },
  // Optional: require user approval before execution
  needsApproval: false,
});
```

For tools that should stop the agent loop:
```typescript
import { hasToolCall } from 'ai';

// In agent config:
stopWhen: hasToolCall('finalAnswer')
```
</ai_sdk_tool_patterns>

<requirements>
1. Delete existing tools:
   - Remove `/lib/ai/tools/get-weather.ts`
   - Remove `/lib/ai/tools/create-document.ts`
   - Remove `/lib/ai/tools/update-document.ts`
   - Remove `/lib/ai/tools/request-suggestions.ts`

2. Create new web-focused tools in `/lib/ai/tools/`:

   **webSearch** (`web-search.ts`):
   - Search the web using a search API (use Tavily, Serper, or similar)
   - Input: query (string), maxResults (number, default 5)
   - Output: Array of { title, url, snippet, publishedDate? }
   - Include rate limiting awareness
   - NO user approval needed (safe read-only operation)

   **fetchUrl** (`fetch-url.ts`):
   - Fetch and extract content from a URL
   - Input: url (string), extractMainContent (boolean, default true)
   - Output: { title, content, url, extractedAt }
   - Handle errors gracefully (404, timeout, etc.)
   - Sanitize HTML, extract main content (strip nav, ads, etc.)
   - NO user approval needed

   **analyzeContent** (`analyze-content.ts`):
   - Analyze/summarize content that was fetched
   - Input: content (string), analysisType ('summarize' | 'extract_facts' | 'find_answers'), query? (string)
   - Output: { analysis, keyPoints?, confidence }
   - This tool enables the agent to process large content without context overflow
   - NO user approval needed

   **finalAnswer** (`final-answer.ts`):
   - Signal that the agent has completed its task
   - Input: answer (string), sources? (array of URLs), confidence ('high' | 'medium' | 'low')
   - Output: The formatted final response
   - This tool should trigger agent loop termination via hasToolCall('finalAnswer')
   - NO user approval needed

3. Update `/lib/ai/tools/index.ts`:
   - Export all new tools
   - Export a `agentTools` object containing all tools for easy import
   - Export individual tools for selective use

4. Update agent configuration to use new tools:
   - Import tools in `/lib/ai/agent.ts`
   - Add `hasToolCall('finalAnswer')` to stop conditions
</requirements>

<implementation_guidelines>
For webSearch:
- Use environment variable for API key (e.g., TAVILY_API_KEY or SERPER_API_KEY)
- If no API key is configured, return a helpful error message suggesting configuration
- Consider caching results briefly to avoid duplicate searches

For fetchUrl:
- Use native fetch() with timeout (10 seconds max)
- Strip HTML tags, extract text content
- Handle common edge cases: redirects, rate limits, bot detection
- Respect robots.txt conceptually (don't fetch sensitive paths)
- Limit content length returned (e.g., first 10000 chars)

For analyzeContent:
- This is a "tool that calls the LLM" pattern
- Use a fast model (e.g., claude-haiku or gpt-4-mini) for analysis
- Keep prompts focused on the specific analysis type
- Return structured output

For finalAnswer:
- This is primarily a signal tool for loop control
- The execute function should format the answer nicely
- Sources should be validated URLs

Error handling for all tools:
- Never throw errors that crash the agent
- Return structured error objects: { error: string, code: string }
- Let the agent decide how to handle failures
</implementation_guidelines>

<environment_setup>
Add these to .env.example (don't modify .env directly):
```
# Web Search API (choose one)
TAVILY_API_KEY=
# or
SERPER_API_KEY=
```
</environment_setup>

<output>
Delete these files:
- `./lib/ai/tools/get-weather.ts`
- `./lib/ai/tools/create-document.ts`
- `./lib/ai/tools/update-document.ts`
- `./lib/ai/tools/request-suggestions.ts`

Create these files:
- `./lib/ai/tools/web-search.ts`
- `./lib/ai/tools/fetch-url.ts`
- `./lib/ai/tools/analyze-content.ts`
- `./lib/ai/tools/final-answer.ts`

Modify these files:
- `./lib/ai/tools/index.ts` - New exports
- `./lib/ai/agent.ts` - Import and use new tools
- `./.env.example` - Add API key placeholders
</output>

<verification>
Before completing, verify:
1. All old tool files are deleted
2. All new tool files compile without TypeScript errors
3. Tools are properly exported from index.ts
4. Agent imports and uses the new tools
5. Each tool has clear descriptions for the model
6. Error cases return structured errors, not thrown exceptions
7. Run `pnpm build` to verify no build errors
</verification>

<success_criteria>
- Four new tools implemented: webSearch, fetchUrl, analyzeContent, finalAnswer
- Old tools completely removed
- Tools follow AI SDK v6 patterns
- finalAnswer tool triggers agent loop termination
- All tools have proper TypeScript types
- Tools handle errors gracefully
- Environment variables documented in .env.example
</success_criteria>
