-- Migration: Drop deprecated Message and Vote tables
-- These have been replaced by Message_v2 and Vote_v2

DROP TABLE IF EXISTS "Vote";
DROP TABLE IF EXISTS "Message";
