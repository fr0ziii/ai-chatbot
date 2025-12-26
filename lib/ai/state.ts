import "server-only";

import {
  getAgentState as dbGetAgentState,
  saveAgentState,
  updateAgentState as dbUpdateAgentState,
  deleteAgentState,
} from "@/lib/db/queries";
import type {
  AgentPlan,
  AgentState,
  AgentStateStatus,
  CompletedStep,
} from "@/lib/db/schema";

// Re-export types for convenience
export type { AgentPlan, AgentState, AgentStateStatus, CompletedStep };

// Max tokens for accumulated context (conservative estimate: ~4 chars/token)
const MAX_CONTEXT_CHARS = 16000;

/**
 * Initialize agent state for a new chat or reset existing state
 */
export async function initializeAgentState(
  chatId: string
): Promise<AgentState> {
  // Check if state already exists
  const existing = await dbGetAgentState({ chatId });
  if (existing) {
    // Reset to idle for new task
    const updated = await dbUpdateAgentState({
      chatId,
      updates: {
        status: "idle",
        plan: null,
        currentStepIndex: 0,
        completedSteps: [],
        context: {},
      },
    });
    return updated!;
  }

  return saveAgentState({ chatId, status: "idle" });
}

/**
 * Get agent state for a chat
 */
export async function getAgentState(
  chatId: string
): Promise<AgentState | null> {
  return dbGetAgentState({ chatId });
}

/**
 * Update agent state with partial updates
 */
export async function updateAgentState(
  chatId: string,
  updates: Partial<
    Pick<
      AgentState,
      "plan" | "currentStepIndex" | "completedSteps" | "context" | "status"
    >
  >
): Promise<AgentState | null> {
  return dbUpdateAgentState({ chatId, updates });
}

/**
 * Update the execution plan
 */
export async function updatePlan(
  chatId: string,
  plan: AgentPlan
): Promise<AgentState | null> {
  return dbUpdateAgentState({
    chatId,
    updates: {
      plan,
      status: "executing",
      currentStepIndex: 0,
    },
  });
}

/**
 * Clear agent state for a chat (full reset)
 */
export async function clearAgentState(chatId: string): Promise<void> {
  await deleteAgentState({ chatId });
}

/**
 * Format state context for injection into system prompt
 * This provides the agent with awareness of its current plan and progress
 */
export function formatStateContext(state: AgentState | null): string {
  if (!state || state.status === "idle") {
    return "";
  }

  const parts: string[] = ["<agent_state>"];

  // Current plan section
  if (state.plan) {
    parts.push("  <current_plan>");
    parts.push(`    Goal: ${state.plan.goal}`);
    parts.push("    Steps:");

    state.plan.steps.forEach((step, idx) => {
      const currentIdx = state.currentStepIndex ?? 0;
      let statusMarker: string;

      if (idx < currentIdx) {
        statusMarker = "[DONE]";
      } else if (idx === currentIdx) {
        statusMarker = "[IN PROGRESS]";
      } else {
        statusMarker = "[PENDING]";
      }

      const resultSuffix =
        step.result && idx < currentIdx ? ` - Result: ${step.result}` : "";
      parts.push(`    ${idx + 1}. ${statusMarker} ${step.description}${resultSuffix}`);
    });

    parts.push("  </current_plan>");
  }

  // Accumulated context section
  if (
    state.context &&
    typeof state.context === "object" &&
    Object.keys(state.context).length > 0
  ) {
    parts.push("  <accumulated_context>");

    // Format context entries
    for (const [key, value] of Object.entries(state.context)) {
      const valueStr = typeof value === "string" ? value : JSON.stringify(value);
      parts.push(`    ${key}: ${valueStr}`);
    }

    parts.push("  </accumulated_context>");
  }

  // Completed steps summary (if any)
  if (state.completedSteps && state.completedSteps.length > 0) {
    parts.push("  <completed_steps>");
    for (const step of state.completedSteps) {
      parts.push(`    - ${step.description}: ${step.result}`);
    }
    parts.push("  </completed_steps>");
  }

  parts.push("</agent_state>");

  const formatted = parts.join("\n");

  // Enforce memory limit by truncating if needed
  if (formatted.length > MAX_CONTEXT_CHARS) {
    return truncateContext(formatted, MAX_CONTEXT_CHARS);
  }

  return formatted;
}

/**
 * Truncate context to fit within token limits
 * Keeps the most recent/important information
 */
function truncateContext(context: string, maxChars: number): string {
  if (context.length <= maxChars) return context;

  // Keep the structure but truncate middle content
  const header = "<agent_state>\n  [Context truncated due to length]\n";
  const footer = "\n</agent_state>";
  const availableChars = maxChars - header.length - footer.length;

  // Take the end of the content (most recent)
  const truncated = context.slice(-availableChars);

  return header + truncated + footer;
}

/**
 * Add findings to accumulated context
 */
export async function addToContext(
  chatId: string,
  key: string,
  value: unknown
): Promise<AgentState | null> {
  const state = await dbGetAgentState({ chatId });
  if (!state) return null;

  const currentContext = (state.context ?? {}) as Record<string, unknown>;
  const updatedContext = { ...currentContext, [key]: value };

  return dbUpdateAgentState({
    chatId,
    updates: { context: updatedContext },
  });
}

/**
 * Mark current step as complete and advance
 */
export async function completeCurrentStep(
  chatId: string,
  result: string
): Promise<AgentState | null> {
  const state = await dbGetAgentState({ chatId });
  if (!state || !state.plan) return null;

  const currentIdx = state.currentStepIndex ?? 0;
  const currentStep = state.plan.steps[currentIdx];
  if (!currentStep) return null;

  // Add to completed steps
  const completedStep: CompletedStep = {
    stepId: currentStep.id,
    description: currentStep.description,
    result,
    timestamp: new Date().toISOString(),
  };

  const completedSteps = [...(state.completedSteps ?? []), completedStep];

  // Update plan step status
  const updatedPlan: AgentPlan = {
    ...state.plan,
    steps: state.plan.steps.map((step, idx) =>
      idx === currentIdx ? { ...step, status: "done", result } : step
    ),
  };

  // Check if all steps are complete
  const allComplete = currentIdx >= state.plan.steps.length - 1;
  const newStatus: AgentStateStatus = allComplete ? "completed" : "executing";

  return dbUpdateAgentState({
    chatId,
    updates: {
      plan: updatedPlan,
      completedSteps,
      currentStepIndex: currentIdx + 1,
      status: newStatus,
    },
  });
}
