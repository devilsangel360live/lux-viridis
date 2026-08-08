DROP INDEX `nodes_sibling_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_sibling_unique` ON `nodes` (`project_id`,`root`,`parent_id`,`idx`);