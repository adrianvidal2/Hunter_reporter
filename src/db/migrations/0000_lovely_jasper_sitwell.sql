CREATE TABLE `files` (
	`path` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`project`) REFERENCES `projects`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`name` text PRIMARY KEY NOT NULL,
	`indexed_at` integer NOT NULL
);
