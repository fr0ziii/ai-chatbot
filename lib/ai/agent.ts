import {
  ToolLoopAgent,
  type InferAgentUIMessage,
  stepCountIs,
  smoothStream,
  type UIMessageStreamWriter,
  type LanguageModel,
  hasToolCall,
} from "ai";
import type { Session } from "next-auth";
import { agentTools } from "./tools";
import {
  getAgentState,
  formatStateContext,
  completeCurrentStep,
  addToContext,
  updateAgentState,
} from "./state";
import type { ChatMessage } from "@/lib/types";

export type CreateAgentOptions = {
  model: LanguageModel;
  systemPrompt: string;
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  chatId?: string;
  isReasoningModel?: boolean;
  maxSteps?: number;
};

// Define the chat tools for the agent
const createChatTools = () => agentTools;

type ChatTools = typeof agentTools;

export function createAgent({
  model,
  systemPrompt,
  session,
  dataStream,
  chatId,
  isReasoningModel = false,
  maxSteps = 5,
}: CreateAgentOptions) {
  if (isReasoningModel) {
    // Reasoning models don't use tools
    return new ToolLoopAgent({
      model,
      instructions: systemPrompt,
      toolChoice: "none",
      stopWhen: stepCountIs(maxSteps),
      prepareStep: async () => ({}),
    });
  }

  const tools = createChatTools();

  // Track the last processed step to detect new completions
  let lastProcessedStepCount = 0;

  return new ToolLoopAgent<never, ChatTools>({
    model,
    instructions: systemPrompt,
    tools,
    toolChoice: "auto",
    stopWhen: (event) =>
      hasToolCall("finalAnswer")(event) || stepCountIs(maxSteps)(event),
    prepareStep: async ({ stepNumber, steps, messages }) => {
      // Inject state context if we have a chatId
      if (!chatId) {
        return {};
      }

      try {
        // Check if we have new completed steps to record
        if (steps.length > lastProcessedStepCount) {
          // Process newly completed steps
          for (let i = lastProcessedStepCount; i < steps.length; i++) {
            const completedStep = steps[i];

            // Record tool results in context
            if (completedStep.toolResults && completedStep.toolResults.length > 0) {
              for (const toolResult of completedStep.toolResults) {
                // Safely extract result - toolResult may have different shapes
                const resultObj = toolResult as unknown as { result?: unknown };
                const resultValue = resultObj.result;
                const resultSummary =
                  typeof resultValue === "string"
                    ? resultValue.slice(0, 500)
                    : JSON.stringify(resultValue ?? toolResult).slice(0, 500);

                // Add to accumulated context
                await addToContext(
                  chatId,
                  `step_${i + 1}_${toolResult.toolName}`,
                  resultSummary
                );
              }


              // Complete the current step in the plan if one exists
              const state = await getAgentState(chatId);
              if (state?.plan && state.currentStepIndex !== undefined) {
                const toolNames = completedStep.toolResults
                  .map((r) => r.toolName)
                  .join(", ");
                await completeCurrentStep(
                  chatId,
                  `Executed: ${toolNames}`
                );
              }
            }
          }

          lastProcessedStepCount = steps.length;
        }

        const state = await getAgentState(chatId);

        // No state or idle state - don't inject anything
        if (!state || state.status === "idle") {
          return {};
        }

        const stateContext = formatStateContext(state);
        if (!stateContext) {
          return {};
        }

        // Stream state status to client
        dataStream.write({ type: "data-agent-status", data: state.status });

        // Stream plan progress if we have one
        if (state.plan) {
          dataStream.write({
            type: "data-agent-plan",
            data: state.plan,
          });
        }

        // Append state context as a system message for this step
        return {
          messages: [
            ...messages,
            {
              role: "system" as const,
              content: `[Step ${stepNumber}] Current agent state:\n${stateContext}`,
            },
          ],
        };
      } catch (error) {
        console.error("Failed to inject agent state:", error);
        return {};
      }
    },
  });
}

// Agent type for non-reasoning models (with tools)
export type ChatAgent = ToolLoopAgent<never, ChatTools>;

// Agent message type - union of both agent types
export type AgentMessage = InferAgentUIMessage<ChatAgent>;

// Smooth stream transform to apply during streaming
export { smoothStream };

