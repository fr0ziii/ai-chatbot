import { geolocation } from "@vercel/functions";
import {
	convertToModelMessages,
	createUIMessageStream,
	JsonToSseTransformStream,
} from "ai";
import { after } from "next/server";
import {
	createResumableStreamContext,
	type ResumableStreamContext,
} from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { createAgent, smoothStream } from "@/lib/ai/agent";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { createPlan, shouldCreatePlan } from "@/lib/ai/planning";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { initializeAgentState, updatePlan } from "@/lib/ai/state";
import {
	createStreamId,
	deleteChatById,
	getChatById,
	getMessageCountByUserId,
	getMessagesByChatId,
	saveChat,
	saveMessages,
	updateChatTitleById,
	updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatSDKError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

let globalStreamContext: ResumableStreamContext | null = null;

export function getStreamContext() {
	if (!globalStreamContext) {
		try {
			globalStreamContext = createResumableStreamContext({
				waitUntil: after,
			});
		} catch (error: any) {
			if (error.message.includes("REDIS_URL")) {
				console.log(
					" > Resumable streams are disabled due to missing REDIS_URL"
				);
			} else {
				console.error(error);
			}
		}
	}

	return globalStreamContext;
}

export async function POST(request: Request) {
	let requestBody: PostRequestBody;

	try {
		const json = await request.json();
		requestBody = postRequestBodySchema.parse(json);
	} catch (_) {
		return new ChatSDKError("bad_request:api").toResponse();
	}

	try {
		const { id, message, messages, selectedChatModel, selectedVisibilityType } =
			requestBody;

		const session = await auth();

		if (!session?.user) {
			return new ChatSDKError("unauthorized:chat").toResponse();
		}

		const userType: UserType = session.user.type;

		const messageCount = await getMessageCountByUserId({
			id: session.user.id,
			differenceInHours: 24,
		});

		if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
			return new ChatSDKError("rate_limit:chat").toResponse();
		}

		// Check if this is a tool approval flow (all messages sent)
		const isToolApprovalFlow = Boolean(messages);

		const chat = await getChatById({ id });
		let messagesFromDb: DBMessage[] = [];
		let titlePromise: Promise<string> | null = null;

		if (chat) {
			if (chat.userId !== session.user.id) {
				return new ChatSDKError("forbidden:chat").toResponse();
			}
			// Only fetch messages if chat already exists and not tool approval
			if (!isToolApprovalFlow) {
				messagesFromDb = await getMessagesByChatId({ id });
			}
		} else if (message?.role === "user") {
			// Save chat immediately with placeholder title
			await saveChat({
				id,
				userId: session.user.id,
				title: "New chat",
				visibility: selectedVisibilityType,
			});

			// Initialize agent state for new chat
			await initializeAgentState(id);

			// Start title generation in parallel (don't await)
			titlePromise = generateTitleFromUserMessage({ message });
		}

		// Use all messages for tool approval, otherwise DB messages + new message
		const uiMessages = isToolApprovalFlow
			? (messages as ChatMessage[])
			: [...convertToUIMessages(messagesFromDb), message as ChatMessage];

		const { longitude, latitude, city, country } = geolocation(request);

		const requestHints: RequestHints = {
			longitude,
			latitude,
			city,
			country,
		};

		// Only save user messages to the database (not tool approval responses)
		if (message?.role === "user") {
			await saveMessages({
				messages: [
					{
						chatId: id,
						id: message.id,
						role: "user",
						parts: message.parts,
						attachments: [],
						createdAt: new Date(),
					},
				],
			});
		}

		const streamId = generateUUID();
		await createStreamId({ streamId, chatId: id });

		const stream = createUIMessageStream({
			// Pass original messages for tool approval continuation
			originalMessages: isToolApprovalFlow ? uiMessages : undefined,
			execute: async ({ writer: dataStream }) => {
				// Handle title generation in parallel
				if (titlePromise) {
					titlePromise.then((title) => {
						updateChatTitleById({ chatId: id, title });
						dataStream.write({ type: "data-chat-title", data: title });
					});
				}

				const isReasoningModel =
					selectedChatModel.includes("reasoning") ||
					selectedChatModel.includes("thinking");

				// For non-reasoning models, check if we need to create a plan
				if (
					!isReasoningModel &&
					message?.role === "user" &&
					!isToolApprovalFlow
				) {
					const userContent = message.parts
						.filter(
							(p): p is { type: "text"; text: string } => p.type === "text"
						)
						.map((p) => p.text)
						.join(" ");

					if (shouldCreatePlan(userContent)) {
						try {
							dataStream.write({ type: "data-agent-status", data: "planning" });

							const plan = await createPlan(userContent);
							await updatePlan(id, plan);

							dataStream.write({ type: "data-agent-plan", data: plan });
							dataStream.write({
								type: "data-agent-status",
								data: "executing",
							});
						} catch (error) {
							console.error("Failed to create plan:", error);
							// Continue without plan - agent will still work
						}
					}
				}

				const agent = createAgent({
					model: getLanguageModel(selectedChatModel),
					systemPrompt: systemPrompt({ selectedChatModel, requestHints }),
					session,
					dataStream,
					chatId: id,
					isReasoningModel,
					maxSteps: 5,
				});

				const result = await agent.stream({
					messages: await convertToModelMessages(uiMessages),
					experimental_transform: isReasoningModel
						? undefined
						: smoothStream({ chunking: "word" }),
				});

				result.consumeStream();

				dataStream.merge(
					result.toUIMessageStream({
						sendReasoning: true,
					})
				);
			},
			generateId: generateUUID,
			onFinish: async ({ messages: finishedMessages }) => {
				if (isToolApprovalFlow) {
					// For tool approval, update existing messages (tool state changed) and save new ones
					for (const finishedMsg of finishedMessages) {
						const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
						if (existingMsg) {
							// Update existing message with new parts (tool state changed)
							await updateMessage({
								id: finishedMsg.id,
								parts: finishedMsg.parts,
							});
						} else {
							// Save new message
							await saveMessages({
								messages: [
									{
										id: finishedMsg.id,
										role: finishedMsg.role,
										parts: finishedMsg.parts,
										createdAt: new Date(),
										attachments: [],
										chatId: id,
									},
								],
							});
						}
					}
				} else if (finishedMessages.length > 0) {
					// Normal flow - save all finished messages
					await saveMessages({
						messages: finishedMessages.map((currentMessage) => ({
							id: currentMessage.id,
							role: currentMessage.role,
							parts: currentMessage.parts,
							createdAt: new Date(),
							attachments: [],
							chatId: id,
						})),
					});
				}
			},
			onError: () => {
				return "Oops, an error occurred!";
			},
		});

		const streamContext = getStreamContext();

		if (streamContext) {
			try {
				const resumableStream = await streamContext.resumableStream(
					streamId,
					() => stream.pipeThrough(new JsonToSseTransformStream())
				);
				if (resumableStream) {
					return new Response(resumableStream);
				}
			} catch (error) {
				console.error("Failed to create resumable stream:", error);
			}
		}

		return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
	} catch (error) {
		const vercelId = request.headers.get("x-vercel-id");

		if (error instanceof ChatSDKError) {
			return error.toResponse();
		}

		// Check for Vercel AI Gateway credit card error
		if (
			error instanceof Error &&
			error.message?.includes(
				"AI Gateway requires a valid credit card on file to service requests"
			)
		) {
			return new ChatSDKError("bad_request:activate_gateway").toResponse();
		}

		console.error("Unhandled error in chat API:", error, { vercelId });
		return new ChatSDKError("offline:chat").toResponse();
	}
}

export async function DELETE(request: Request) {
	const { searchParams } = new URL(request.url);
	const id = searchParams.get("id");

	if (!id) {
		return new ChatSDKError("bad_request:api").toResponse();
	}

	const session = await auth();

	if (!session?.user) {
		return new ChatSDKError("unauthorized:chat").toResponse();
	}

	const chat = await getChatById({ id });

	if (chat?.userId !== session.user.id) {
		return new ChatSDKError("forbidden:chat").toResponse();
	}

	const deletedChat = await deleteChatById({ id });

	return Response.json(deletedChat, { status: 200 });
}
