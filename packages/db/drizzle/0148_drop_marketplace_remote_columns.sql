PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plugin_marketplaces` (
	`name` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`manifest_url` text NOT NULL,
	`source_git_ref` text,
	`source_git_subdirectory` text,
	`source_git_commit` text,
	`manifest_json` text NOT NULL,
	`last_successful_refresh_at` integer,
	`last_attempted_refresh_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_plugin_marketplaces`("name", "source_kind", "manifest_url", "source_git_ref", "source_git_subdirectory", "source_git_commit", "manifest_json", "last_successful_refresh_at", "last_attempted_refresh_at", "last_error", "created_at", "updated_at") SELECT "name", "source_kind", "manifest_url", "source_git_ref", "source_git_subdirectory", "source_git_commit", "manifest_json", "last_successful_refresh_at", "last_attempted_refresh_at", "last_error", "created_at", "updated_at" FROM `plugin_marketplaces`;--> statement-breakpoint
DROP TABLE `plugin_marketplaces`;--> statement-breakpoint
ALTER TABLE `__new_plugin_marketplaces` RENAME TO `plugin_marketplaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;