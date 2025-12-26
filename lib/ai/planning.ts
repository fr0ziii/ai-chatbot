import "server-only";

import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { z } from "zod";
import type { AgentPlan, PlanStep } from "@/lib/db/schema";
import { generateUUID } from "@/lib/utils";

// Planning model - fast and cheap for plan generation
// Can be overridden via PLANNING_MODEL environment variable
const PLANNING_MODEL = gateway(
  process.env.PLANNING_MODEL || "google/gemini-2.5-flash-lite"
);

// Plan step schema for structured output
const PlanStepSchema = z.object({
  description: z
    .string()
    .describe("Clear description of what this step accomplishes"),
  tool: z
    .enum([
      "fetchUrl",
      "webSearch",
      "webExtract",
      "analyzeContent",
      "createDocument",
      "updateDocument",
      "finalAnswer",
    ])
    .optional()
    .describe("Which tool to use for this step, if applicable"),
});

const PlanSchema = z.object({
  goal: z.string().describe("The overarching goal to accomplish"),
  steps: z
    .array(PlanStepSchema)
    .min(1)
    .max(7)
    .describe("Ordered list of steps to accomplish the goal"),
  reasoning: z
    .string()
    .describe("Brief explanation of why this plan makes sense"),
});

type PlanOutput = z.infer<typeof PlanSchema>;

/**
 * System prompt for the planning agent
 */
const PLANNING_SYSTEM_PROMPT = `You are a planning agent that creates structured execution plans for tasks.

Your job is to break down a user's request into a clear, actionable plan.

Guidelines:
- Create between 1-7 steps (prefer fewer, focused steps)
- Each step should be concrete and achievable
- Consider which tools might be needed based on the task
- The final step should usually involve synthesizing results with finalAnswer
- Keep the plan focused on the user's actual request

Available tools:
- webSearch: Search the web for information using Tavily
- webExtract: Extract clean content from multiple URLs
- fetchUrl: Fetch and extract content from a specific URL
- analyzeContent: Analyze and synthesize information
- createDocument: Create a new document (text, code, or spreadsheet)
- updateDocument: Modify an existing document
- finalAnswer: Provide the final response to the user`;

export interface PlanContext {
  recentMessages?: string;
  userProfile?: string;
}

/**
 * Create an execution plan for a given task
 */
export async function createPlan(
  task: string,
  context?: PlanContext
): Promise<AgentPlan> {
  const contextSection = context
    ? `\n\nContext:\n${context.recentMessages || ""}\n${context.userProfile || ""}`
    : "";

  try {
    const result = await generateObject({
      model: PLANNING_MODEL,
      schema: PlanSchema,
      system: PLANNING_SYSTEM_PROMPT,
      prompt: `Create a plan to accomplish this task: "${task}"${contextSection}`,
    });

    return convertToPlan(result.object);
  } catch (error) {
    console.error("Failed to generate plan:", error);
    // Fallback to simple single-step plan
    return createFallbackPlan(task);
  }
}

/**
 * Convert structured output to AgentPlan with proper IDs
 */
function convertToPlan(output: PlanOutput): AgentPlan {
  const steps: PlanStep[] = output.steps.map((step) => ({
    id: generateUUID(),
    description: step.description,
    tool: step.tool,
    status: "pending",
  }));

  return {
    goal: output.goal,
    steps,
    reasoning: output.reasoning,
  };
}

/**
 * Create a simple fallback plan when LLM planning fails
 */
function createFallbackPlan(task: string): AgentPlan {
  return {
    goal: task,
    steps: [
      {
        id: generateUUID(),
        description: "Analyze the request and gather information",
        status: "pending",
      },
      {
        id: generateUUID(),
        description: "Provide comprehensive response",
        tool: "finalAnswer",
        status: "pending",
      },
    ],
    reasoning: "Fallback plan due to planning error",
  };
}

/**
 * Check if a task is complex enough to warrant planning
 * Simple questions don't need multi-step plans
 */
export function shouldCreatePlan(task: string): boolean {
  // Short, simple questions don't need planning
  if (task.length < 50) return false;

  // Look for indicators of complex tasks
  const complexIndicators = [
    "research",
    "analyze",
    "compare",
    "summarize",
    "find and",
    "search for",
    "look up",
    "multiple",
    "step",
    "then",
    "after that",
    "first",
    "finally",
  ];

  const lowerTask = task.toLowerCase();
  return complexIndicators.some((indicator) => lowerTask.includes(indicator));
}

/**
 * Evaluate if the current plan needs adjustment based on results
 */
export function shouldReplan(
  currentPlan: AgentPlan,
  stepResult: string
): boolean {
  // Check for failure indicators in result
  const failureIndicators = [
    "error",
    "failed",
    "not found",
    "unable to",
    "could not",
  ];

  const lowerResult = stepResult.toLowerCase();
  const hasFailed = failureIndicators.some((indicator) =>
    lowerResult.includes(indicator)
  );

  // If step failed and we have more pending steps, might need to replan
  if (hasFailed) {
    const pendingSteps = currentPlan.steps.filter(
      (s) => s.status === "pending"
    );
    return pendingSteps.length > 0;
  }

  return false;
}
