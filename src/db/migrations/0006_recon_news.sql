-- Novedades de monitorización continua (Tarea 9b): assets NUEVOS del diff
-- entre ciclos del scheduler. ÍNDICE RECONSTRUIBLE desde los output.log.
CREATE TABLE `recon_news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`tool` text NOT NULL,
	`item` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recon_news_uq` ON `recon_news` (`project`,`tool`,`item`);--> statement-breakpoint
CREATE INDEX `recon_news_seen_idx` ON `recon_news` (`last_seen_at`);
