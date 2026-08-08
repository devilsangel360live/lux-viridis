ALTER TABLE `nodes` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `nodes` ADD `prev_parent_id` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `prev_root` text;--> statement-breakpoint
CREATE INDEX `nodes_deleted_idx` ON `nodes` (`project_id`,`deleted_at`);--> statement-breakpoint
ALTER TABLE `snapshots` ADD `kind` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `title` text;--> statement-breakpoint
ALTER TABLE `snapshots` ADD `plain` text DEFAULT '' NOT NULL;