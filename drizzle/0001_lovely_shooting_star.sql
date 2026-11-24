ALTER TABLE `users` ADD `status` enum('pending','active','disabled') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `sessionVersion` int DEFAULT 1 NOT NULL;