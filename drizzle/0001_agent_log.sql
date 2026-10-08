CREATE TABLE `agent_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`ts` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text,
	`result_json` text,
	`duration_ms` integer,
	`ok` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
