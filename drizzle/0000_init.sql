CREATE TABLE `dependencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`from_task_id` integer NOT NULL,
	`to_task_id` integer NOT NULL,
	`type` integer DEFAULT 2 NOT NULL,
	`lag` real DEFAULT 0 NOT NULL,
	`lag_unit` text DEFAULT 'day' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`client_name` text NOT NULL,
	`client_email` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`budget_cents` integer NOT NULL,
	`brief_text` text,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`parent_id` integer,
	`order_index` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`duration` real,
	`duration_unit` text DEFAULT 'day' NOT NULL,
	`percent_done` real DEFAULT 0 NOT NULL,
	`constraint_type` text,
	`constraint_date` text,
	`manually_scheduled` integer DEFAULT false NOT NULL,
	`expanded` integer DEFAULT true NOT NULL,
	`amount_cents` integer,
	`invoice_status` text DEFAULT 'none' NOT NULL,
	`payment_gate` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
