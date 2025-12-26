import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/artifact";
import type { webSearch } from "./ai/tools/web-search";
import type { fetchUrl } from "./ai/tools/fetch-url";
import type { analyzeContent } from "./ai/tools/analyze-content";
import type { finalAnswer } from "./ai/tools/final-answer";
import type { Suggestion } from "./db/schema";

export type { AgentMessage } from "./ai/agent";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type webSearchTool = InferUITool<typeof webSearch>;
type fetchUrlTool = InferUITool<typeof fetchUrl>;
type analyzeContentTool = InferUITool<typeof analyzeContent>;
type finalAnswerTool = InferUITool<typeof finalAnswer>;

export type ChatTools = {
  webSearch: webSearchTool;
  fetchUrl: fetchUrlTool;
  analyzeContent: analyzeContentTool;
  finalAnswer: finalAnswerTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  "chat-title": string;
  // Agent state streaming types
  "agent-plan": {
    goal: string;
    steps: Array<{ id: string; description: string; status: string }>;
  };
  "agent-step-progress": { stepIndex: number; status: string; result?: string };
  "agent-status": string;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
