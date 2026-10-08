CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`task_id` integer,
	`paypal_invoice_id` text NOT NULL,
	`invoice_number` text,
	`milestone_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`paypal_status` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`note_source` text,
	`pay_url` text,
	`invoicer_url` text,
	`qr_png` text,
	`sent_at` text,
	`due_at` text,
	`paid_at` text,
	`last_reminder_at` text,
	`reminder_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_paypal_invoice_id_unique` ON `invoices` (`paypal_invoice_id`);