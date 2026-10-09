ALTER TABLE `projects` ADD `owner_token` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_demo` integer DEFAULT false NOT NULL;