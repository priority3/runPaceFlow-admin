CREATE TABLE IF NOT EXISTS `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`trigger` text NOT NULL,
	`subject_type` text,
	`subject_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_hash` text,
	`builder_version` text NOT NULL,
	`model` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_step` text,
	`locked_by` text,
	`locked_until` integer,
	`next_retry_at` integer,
	`error_code` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `activity_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`activity_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`features_json` text NOT NULL,
	`context_json` text,
	`content` text NOT NULL,
	`model` text NOT NULL,
	`provider` text,
	`input_hash` text NOT NULL,
	`builder_version` text NOT NULL,
	`prompt_version` text NOT NULL,
	`superseded_by` text,
	`is_current` integer DEFAULT 1 NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`type` text NOT NULL,
	`at_seconds` integer,
	`kilometer` real,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `activity_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_state_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`payload_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`provider_message_id` text,
	`error_code` text,
	`last_error` text,
	`next_retry_at` integer,
	`locked_by` text,
	`locked_until` integer,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `activity_reviews`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subjective_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text,
	`mood` text,
	`rpe` integer,
	`pain_json` text,
	`note` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`content` text NOT NULL,
	`evidence_json` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text,
	`run_id` text,
	`idempotency_key` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'applied' NOT NULL,
	`patch_json` text NOT NULL,
	`actor` text NOT NULL,
	`expected_version` integer,
	`resulting_version` integer,
	`reason` text,
	`conflict_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `friend_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`companion_style_json` text,
	`active_goals_json` text,
	`training_preferences_json` text,
	`injury_watchlist_json` text,
	`recent_state_json` text,
	`do_not_assume_json` text,
	`projection_version` integer DEFAULT 1 NOT NULL,
	`source_diary_id` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `friend_diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`content` text NOT NULL,
	`observations_json` text,
	`memory_patches_json` text,
	`model` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `race_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`race_date` integer NOT NULL,
	`distance_meters` real NOT NULL,
	`target_type` text NOT NULL,
	`target_time_sec` integer,
	`priority` text DEFAULT 'primary' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `health_daily_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`sleep_minutes` integer,
	`deep_sleep_minutes` integer,
	`rem_sleep_minutes` integer,
	`hrv` real,
	`resting_hr` integer,
	`source` text NOT NULL,
	`payload_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `strava_events` (
	`id` text PRIMARY KEY NOT NULL,
	`aspect_type` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`owner_id` text,
	`event_time` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`locked_by` text,
	`locked_until` integer,
	`error_code` text,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `life_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`media_url` text,
	`raw_text` text,
	`observation_json` text,
	`model` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`chunk_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`vector_json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`chunk_id`) REFERENCES `knowledge_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rag_retrieval_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`query` text NOT NULL,
	`query_plan_json` text,
	`result_chunk_ids_json` text NOT NULL,
	`scores_json` text,
	`selected_chunk_ids_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rag_eval_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`expected_topics_json` text,
	`expected_chunk_ids_json` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pr_feedback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`event_type` text NOT NULL,
	`value` text,
	`note` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pr_metric_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`metric_name` text NOT NULL,
	`metric_value` real NOT NULL,
	`dimensions_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`status` text DEFAULT 'active' NOT NULL,
	`summary` text,
	`summary_memory_refs_json` text,
	`last_message_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`run_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`memory_refs_json` text,
	`context_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activity_reviews_activity_id` ON `activity_reviews` (`activity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activity_reviews_kind_created_at` ON `activity_reviews` (`kind`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_activity_reviews_idempotency` ON `activity_reviews` (`kind`,`subject_type`,`subject_id`,`input_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_activity_reviews_current_subject` ON `activity_reviews` (`kind`,`subject_type`,`subject_id`) WHERE is_current = 1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_review_annotations_review_id` ON `review_annotations` (`review_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_runs_trigger_status_created_at` ON `agent_runs` (`trigger`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_runs_subject` ON `agent_runs` (`subject_type`,`subject_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_agent_runs_idempotency` ON `agent_runs` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_agent_state_snapshots_run_id_created_at` ON `agent_state_snapshots` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notification_deliveries_status_created_at` ON `notification_deliveries` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notification_deliveries_review_id` ON `notification_deliveries` (`review_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_notification_deliveries_unique_target` ON `notification_deliveries` (`review_id`,`channel`,`recipient`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subjective_feedback_activity_id` ON `subjective_feedback` (`activity_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_items_type_status` ON `memory_items` (`type`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_items_last_seen_at` ON `memory_items` (`last_seen_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_memory_events_memory_id_created_at` ON `memory_events` (`memory_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_memory_events_idempotency` ON `memory_events` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_friend_diary_entries_period` ON `friend_diary_entries` (`period_start`,`period_end`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_race_goals_status_race_date` ON `race_goals` (`status`,`race_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_health_daily_metrics_date_source` ON `health_daily_metrics` (`date`,`source`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_strava_events_unique` ON `strava_events` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_strava_events_status_retry` ON `strava_events` (`status`,`next_retry_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_life_events_type_occurred_at` ON `life_events` (`type`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_knowledge_chunks_document_id` ON `knowledge_chunks` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rag_retrieval_logs_run_id` ON `rag_retrieval_logs` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pr_feedback_events_target` ON `pr_feedback_events` (`target_type`,`target_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pr_metric_events_name_created_at` ON `pr_metric_events` (`metric_name`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_conversation_messages_thread_id_created_at` ON `conversation_messages` (`thread_id`,`created_at`);
