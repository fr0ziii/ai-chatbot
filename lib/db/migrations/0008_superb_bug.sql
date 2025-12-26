CREATE TABLE IF NOT EXISTS "AgentState" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"plan" json,
	"currentStepIndex" integer DEFAULT 0,
	"completedSteps" json DEFAULT '[]'::json,
	"context" json DEFAULT '{}'::json,
	"status" varchar DEFAULT 'idle' NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "AgentState_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "AgentState" ADD CONSTRAINT "AgentState_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."Chat"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "Chat" DROP COLUMN IF EXISTS "lastContext";