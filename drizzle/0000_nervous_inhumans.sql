CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_code` text NOT NULL,
	`type` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_code` text NOT NULL,
	`question_id` integer NOT NULL,
	`participant_id` text NOT NULL,
	`answer` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_response_per_question` ON `responses` (`question_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`active_question` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
