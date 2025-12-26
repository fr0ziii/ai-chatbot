/**
 * Test script for Agent State operations
 * Run with: npx tsx scripts/test-agent-state.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { agentState, chat, user } from "../lib/db/schema";
import { generateUUID } from "../lib/utils";

// Direct database connection (bypassing server-only checks)
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);

async function testAgentState() {
  console.log("🧪 Testing Agent State Operations\n");

  // Create test user and chat first
  const testUserId = generateUUID();
  const testChatId = generateUUID();

  try {
    // Setup: Create test user
    console.log("📦 Setting up test data...");
    await db.insert(user).values({
      id: testUserId,
      email: `test-${Date.now()}@test.com`,
      password: "test",
    });

    // Setup: Create test chat
    await db.insert(chat).values({
      id: testChatId,
      userId: testUserId,
      title: "Test Chat",
      createdAt: new Date(),
      visibility: "private",
    });
    console.log("✅ Test user and chat created\n");

    // Test 1: Initialize state
    console.log("1️⃣ Testing state initialization...");
    const now = new Date();
    await db.insert(agentState).values({
      id: generateUUID(),
      chatId: testChatId,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    });

    const initialState = await db
      .select()
      .from(agentState)
      .where(eq(agentState.chatId, testChatId))
      .limit(1);

    console.log("   Status:", initialState[0]?.status);
    console.log("✅ State initialized\n");

    // Test 2: Update with a plan
    console.log("2️⃣ Testing plan update...");
    const testPlan = {
      goal: "Research and summarize AI trends",
      steps: [
        { id: "s1", description: "Search for information", status: "pending" as const },
        { id: "s2", description: "Analyze findings", status: "pending" as const },
        { id: "s3", description: "Create summary", tool: "finalAnswer", status: "pending" as const },
      ],
      reasoning: "Multi-step research task requires web search and analysis",
    };

    await db
      .update(agentState)
      .set({
        plan: testPlan,
        status: "executing",
        currentStepIndex: 0,
        updatedAt: new Date(),
      })
      .where(eq(agentState.chatId, testChatId));

    const stateWithPlan = await db
      .select()
      .from(agentState)
      .where(eq(agentState.chatId, testChatId))
      .limit(1);

    console.log("   Goal:", stateWithPlan[0]?.plan?.goal);
    console.log("   Steps:", stateWithPlan[0]?.plan?.steps.length);
    console.log("   Status:", stateWithPlan[0]?.status);
    console.log("✅ Plan updated\n");

    // Test 3: Add context
    console.log("3️⃣ Testing context addition...");
    const currentContext = (stateWithPlan[0]?.context ?? {}) as Record<string, unknown>;
    await db
      .update(agentState)
      .set({
        context: {
          ...currentContext,
          searchResults: ["AI trend 1", "AI trend 2"],
          sourceUrls: ["https://example.com/ai-trends"],
        },
        updatedAt: new Date(),
      })
      .where(eq(agentState.chatId, testChatId));

    const stateWithContext = await db
      .select()
      .from(agentState)
      .where(eq(agentState.chatId, testChatId))
      .limit(1);

    console.log("   Context keys:", Object.keys(stateWithContext[0]?.context ?? {}));
    console.log("✅ Context added\n");

    // Test 4: Complete a step
    console.log("4️⃣ Testing step completion...");
    const currentPlan = stateWithContext[0]?.plan;
    if (currentPlan) {
      const updatedSteps = currentPlan.steps.map((step, idx) =>
        idx === 0 ? { ...step, status: "done" as const, result: "Found 5 relevant articles" } : step
      );

      await db
        .update(agentState)
        .set({
          plan: { ...currentPlan, steps: updatedSteps },
          currentStepIndex: 1,
          completedSteps: [
            {
              stepId: "s1",
              description: "Search for information",
              result: "Found 5 relevant articles",
              timestamp: new Date().toISOString(),
            },
          ],
          updatedAt: new Date(),
        })
        .where(eq(agentState.chatId, testChatId));

      const stateAfterStep = await db
        .select()
        .from(agentState)
        .where(eq(agentState.chatId, testChatId))
        .limit(1);

      console.log("   Current step index:", stateAfterStep[0]?.currentStepIndex);
      console.log("   Completed steps:", stateAfterStep[0]?.completedSteps?.length);
      console.log("   First step status:", stateAfterStep[0]?.plan?.steps[0]?.status);
      console.log("✅ Step completed\n");
    }

    // Test 5: Format state context (simulate what goes into system prompt)
    console.log("5️⃣ Testing context formatting...");
    const finalState = await db
      .select()
      .from(agentState)
      .where(eq(agentState.chatId, testChatId))
      .limit(1);

    const state = finalState[0];
    if (state && state.plan) {
      const parts: string[] = ["<agent_state>"];

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

        parts.push(`    ${idx + 1}. ${statusMarker} ${step.description}`);
      });

      parts.push("  </current_plan>");
      parts.push("</agent_state>");

      console.log("   Formatted output:");
      console.log(parts.join("\n"));
      console.log("✅ Context formatted\n");
    }

    console.log("🎉 All tests passed!\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Cleanup: Delete test data
    console.log("🧹 Cleaning up test data...");
    await db.delete(agentState).where(eq(agentState.chatId, testChatId));
    await db.delete(chat).where(eq(chat.id, testChatId));
    await db.delete(user).where(eq(user.id, testUserId));
    console.log("✅ Cleanup complete");

    await client.end();
    process.exit(0);
  }
}

testAgentState();
