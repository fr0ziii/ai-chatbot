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
import type { ChatMessage } from "@/lib/types";

export type CreateAgentOptions = {
  model: LanguageModel;
  systemPrompt: string;
  session: Session;
  dataStream: UIMessageStreamWriter<ChatMessage>;
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

  return new ToolLoopAgent<never, ChatTools>({
    model,
    instructions: systemPrompt,
    tools,
    toolChoice: "auto",
    stopWhen: (event) =>
      hasToolCall("finalAnswer")(event) || stepCountIs(maxSteps)(event),
    prepareStep: async () => {
      // Future: context trimming, model escalation
      return {};
    },
  });
}

// Agent type for non-reasoning models (with tools)
export type ChatAgent = ToolLoopAgent<never, ChatTools>;

// Agent message type - union of both agent types
export type AgentMessage = InferAgentUIMessage<ChatAgent>;

// Smooth stream transform to apply during streaming
export { smoothStream };
