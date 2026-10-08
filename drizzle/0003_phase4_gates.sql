ALTER TABLE `projects` ADD `payment_terms_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `demo_today` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `gate_hold` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `baselines` text;