CREATE TABLE `llm_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`path` text,
	`model` text NOT NULL,
	`attempts` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`cost_usd` real,
	`cost_basis` text,
	`status` text NOT NULL,
	`error` text
);
