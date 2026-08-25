CREATE TABLE `pending_actions` (
	`path` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`detected_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL
);
