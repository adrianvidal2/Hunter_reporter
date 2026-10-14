CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`tool_id` text NOT NULL,
	`run_dir` text NOT NULL,
	`template_id` text NOT NULL,
	`host` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`matched_at` text,
	`name` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_project_template_host_uq` ON `findings` (`project`,`template_id`,`host`);--> statement-breakpoint
CREATE INDEX `findings_project_severity_idx` ON `findings` (`project`,`severity`);