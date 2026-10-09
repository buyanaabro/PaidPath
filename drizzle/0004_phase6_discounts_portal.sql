ALTER TABLE `invoices` ADD `discount_percent` real;--> statement-breakpoint
ALTER TABLE `invoices` ADD `discount_days` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `discount_until` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `discount_expired_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `paid_amount_cents` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_share_token_unique` ON `projects` (`share_token`);