DROP INDEX `links_unique`;--> statement-breakpoint
ALTER TABLE `links` ADD `kind` text DEFAULT 'mention' NOT NULL;--> statement-breakpoint
ALTER TABLE `links` ADD `label` text;--> statement-breakpoint
CREATE INDEX `links_kind_idx` ON `links` (`project_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `links_unique` ON `links` (`source_id`,`target_id`,`kind`);