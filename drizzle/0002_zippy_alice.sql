CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36),
	`actorId` int,
	`investigationId` varchar(36),
	`entityType` varchar(64) NOT NULL,
	`entityId` varchar(36) NOT NULL,
	`action` varchar(96) NOT NULL,
	`outcome` enum('SUCCESS','DENIED','FAILURE') NOT NULL DEFAULT 'SUCCESS',
	`requestId` varchar(128),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('USER','ASSISTANT','SYSTEM') NOT NULL,
	`content` text NOT NULL,
	`rcaResultId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `corrective_actions` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`rcaResultId` varchar(36),
	`description` text NOT NULL,
	`reason` text,
	`specific` text,
	`measurable` text,
	`achievable` text,
	`relevant` text,
	`timeBound` text,
	`priority` varchar(32),
	`ownerId` int,
	`dueAt` timestamp,
	`status` enum('PLANNED','IN_PROGRESS','DONE','CANCELLED') NOT NULL DEFAULT 'PLANNED',
	`kpi` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `corrective_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`uploadedBy` int NOT NULL,
	`objectKey` varchar(512),
	`kind` varchar(32) NOT NULL,
	`name` varchar(255) NOT NULL,
	`mimeType` varchar(160),
	`sizeBytes` int,
	`mediaHash` varchar(128),
	`metadata` json,
	`note` text,
	`annotations` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `investigation_members` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`permission` enum('READ','WRITE','RUN_AI') NOT NULL,
	`grantedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investigation_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `investigation_members_investigation_user_uq` UNIQUE(`investigationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `investigation_tags` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`tagId` varchar(36) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investigation_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `investigation_tags_pair_uq` UNIQUE(`investigationId`,`tagId`)
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36) NOT NULL,
	`ownerId` int NOT NULL,
	`legacyCaseId` varchar(160),
	`title` varchar(255) NOT NULL,
	`equipmentType` varchar(120) NOT NULL,
	`assetTag` varchar(120) NOT NULL,
	`location` varchar(200) NOT NULL,
	`narrative` text NOT NULL,
	`severity` varchar(32),
	`status` varchar(48) NOT NULL DEFAULT 'DRAFT',
	`tagsSnapshot` json,
	`legacyData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investigations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rca_results` (
	`id` varchar(36) NOT NULL,
	`investigationId` varchar(36) NOT NULL,
	`schemaVersion` varchar(64) NOT NULL,
	`promptVersion` varchar(64) NOT NULL,
	`validatorVersion` varchar(64) NOT NULL,
	`validatedJson` json NOT NULL,
	`provider` varchar(80),
	`modelId` varchar(180),
	`inputTokens` int,
	`outputTokens` int,
	`costUsd` decimal(20,10),
	`isSuperseded` int NOT NULL DEFAULT 0,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rca_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`normalizedName` varchar(120) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_workspace_normalized_name_uq` UNIQUE(`workspaceId`,`normalizedName`)
);
--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36) NOT NULL,
	`targetEmail` varchar(320),
	`targetOpenId` varchar(64),
	`tokenHash` varchar(128) NOT NULL,
	`role` enum('MEMBER','READER') NOT NULL,
	`status` enum('PENDING','ACCEPTED','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING',
	`invitedBy` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`acceptedAt` timestamp,
	CONSTRAINT `workspace_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_invitations_token_hash_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`id` varchar(36) NOT NULL,
	`workspaceId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('ADMIN','MEMBER','READER') NOT NULL,
	`status` enum('ACTIVE','INVITED','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
	`invitedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_members_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_members_workspace_user_uq` UNIQUE(`workspaceId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaces_created_by_name_uq` UNIQUE(`createdBy`,`name`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_workspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_actor_fk` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_events` ADD CONSTRAINT `audit_events_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_rca_result_fk` FOREIGN KEY (`rcaResultId`) REFERENCES `rca_results`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_rca_result_fk` FOREIGN KEY (`rcaResultId`) REFERENCES `rca_results`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_owner_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `corrective_actions` ADD CONSTRAINT `corrective_actions_created_by_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidence` ADD CONSTRAINT `evidence_uploaded_by_fk` FOREIGN KEY (`uploadedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_members` ADD CONSTRAINT `investigation_members_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_members` ADD CONSTRAINT `investigation_members_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_members` ADD CONSTRAINT `investigation_members_granted_by_fk` FOREIGN KEY (`grantedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_tags` ADD CONSTRAINT `investigation_tags_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_tags` ADD CONSTRAINT `investigation_tags_tag_fk` FOREIGN KEY (`tagId`) REFERENCES `tags`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigation_tags` ADD CONSTRAINT `investigation_tags_created_by_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_workspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_owner_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rca_results` ADD CONSTRAINT `rca_results_investigation_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rca_results` ADD CONSTRAINT `rca_results_created_by_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_workspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tags` ADD CONSTRAINT `tags_created_by_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invitations` ADD CONSTRAINT `workspace_invitations_workspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_invitations` ADD CONSTRAINT `workspace_invitations_invited_by_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_workspace_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_user_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_invited_by_fk` FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspaces` ADD CONSTRAINT `workspaces_created_by_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_events_workspace_time_idx` ON `audit_events` (`workspaceId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_time_idx` ON `audit_events` (`entityType`,`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_time_idx` ON `audit_events` (`actorId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `chat_messages_investigation_time_idx` ON `chat_messages` (`investigationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `chat_messages_user_time_idx` ON `chat_messages` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `corrective_actions_investigation_status_due_idx` ON `corrective_actions` (`investigationId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `corrective_actions_owner_idx` ON `corrective_actions` (`ownerId`);--> statement-breakpoint
CREATE INDEX `evidence_investigation_time_idx` ON `evidence` (`investigationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `evidence_investigation_hash_idx` ON `evidence` (`investigationId`,`mediaHash`);--> statement-breakpoint
CREATE INDEX `evidence_uploaded_by_idx` ON `evidence` (`uploadedBy`);--> statement-breakpoint
CREATE INDEX `investigation_members_user_permission_idx` ON `investigation_members` (`userId`,`permission`);--> statement-breakpoint
CREATE INDEX `investigation_tags_tag_idx` ON `investigation_tags` (`tagId`);--> statement-breakpoint
CREATE INDEX `investigations_workspace_time_idx` ON `investigations` (`workspaceId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `investigations_owner_time_idx` ON `investigations` (`ownerId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `investigations_status_idx` ON `investigations` (`workspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `investigations_legacy_case_idx` ON `investigations` (`ownerId`,`legacyCaseId`);--> statement-breakpoint
CREATE INDEX `rca_results_investigation_time_idx` ON `rca_results` (`investigationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `rca_results_current_idx` ON `rca_results` (`investigationId`,`isSuperseded`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tags_workspace_idx` ON `tags` (`workspaceId`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_workspace_status_idx` ON `workspace_invitations` (`workspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_invitations_expiry_idx` ON `workspace_invitations` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `workspace_members_user_status_idx` ON `workspace_members` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `workspace_members_workspace_status_idx` ON `workspace_members` (`workspaceId`,`status`);--> statement-breakpoint
CREATE INDEX `workspaces_created_by_idx` ON `workspaces` (`createdBy`);--> statement-breakpoint
CREATE INDEX `workspaces_status_idx` ON `workspaces` (`status`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);