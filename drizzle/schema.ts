import {
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Provider subject remains the only OAuth identity key; local numeric id is internal.
 */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    status: mysqlEnum("status", ["pending", "active", "disabled"]).default("active").notNull(),
    sessionVersion: int("sessionVersion").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("users_status_idx").on(table.status),
  }),
);

export const workspaces = mysqlTable(
  "workspaces",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["ACTIVE", "ARCHIVED"]).default("ACTIVE").notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    createdByIdx: index("workspaces_created_by_idx").on(table.createdBy),
    statusIdx: index("workspaces_status_idx").on(table.status),
    createdByNameUq: uniqueIndex("workspaces_created_by_name_uq").on(table.createdBy, table.name),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "workspaces_created_by_fk",
    }),
  }),
);

export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspaceId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", ["ADMIN", "MEMBER", "READER"]).notNull(),
    status: mysqlEnum("status", ["ACTIVE", "INVITED", "SUSPENDED"]).default("ACTIVE").notNull(),
    invitedBy: int("invitedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    workspaceUserUq: uniqueIndex("workspace_members_workspace_user_uq").on(table.workspaceId, table.userId),
    userStatusIdx: index("workspace_members_user_status_idx").on(table.userId, table.status),
    workspaceStatusIdx: index("workspace_members_workspace_status_idx").on(table.workspaceId, table.status),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "workspace_members_workspace_fk",
    }),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "workspace_members_user_fk",
    }),
    invitedByFk: foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: "workspace_members_invited_by_fk",
    }),
  }),
);

export const workspaceInvitations = mysqlTable(
  "workspace_invitations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspaceId", { length: 36 }).notNull(),
    targetEmail: varchar("targetEmail", { length: 320 }),
    targetOpenId: varchar("targetOpenId", { length: 64 }),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull(),
    role: mysqlEnum("role", ["MEMBER", "READER"]).notNull(),
    status: mysqlEnum("status", ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]).default("PENDING").notNull(),
    invitedBy: int("invitedBy").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    acceptedAt: timestamp("acceptedAt"),
  },
  (table) => ({
    tokenHashUq: uniqueIndex("workspace_invitations_token_hash_uq").on(table.tokenHash),
    workspaceStatusIdx: index("workspace_invitations_workspace_status_idx").on(table.workspaceId, table.status),
    expiryIdx: index("workspace_invitations_expiry_idx").on(table.expiresAt),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "workspace_invitations_workspace_fk",
    }),
    invitedByFk: foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: "workspace_invitations_invited_by_fk",
    }),
  }),
);

export const investigations = mysqlTable(
  "investigations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspaceId", { length: 36 }).notNull(),
    ownerId: int("ownerId").notNull(),
    legacyCaseId: varchar("legacyCaseId", { length: 160 }),
    title: varchar("title", { length: 255 }).notNull(),
    equipmentType: varchar("equipmentType", { length: 120 }).notNull(),
    assetTag: varchar("assetTag", { length: 120 }).notNull(),
    location: varchar("location", { length: 200 }).notNull(),
    narrative: text("narrative").notNull(),
    severity: varchar("severity", { length: 32 }),
    status: varchar("status", { length: 48 }).default("DRAFT").notNull(),
    tagsSnapshot: json("tagsSnapshot"),
    legacyData: json("legacyData"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    workspaceTimeIdx: index("investigations_workspace_time_idx").on(table.workspaceId, table.createdAt),
    ownerTimeIdx: index("investigations_owner_time_idx").on(table.ownerId, table.createdAt),
    statusIdx: index("investigations_status_idx").on(table.workspaceId, table.status),
    legacyCaseIdx: index("investigations_legacy_case_idx").on(table.ownerId, table.legacyCaseId),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "investigations_workspace_fk",
    }),
    ownerFk: foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "investigations_owner_fk",
    }),
  }),
);

export const investigationMembers = mysqlTable(
  "investigation_members",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    permission: mysqlEnum("permission", ["READ", "WRITE", "RUN_AI"]).notNull(),
    grantedBy: int("grantedBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    investigationUserUq: uniqueIndex("investigation_members_investigation_user_uq").on(table.investigationId, table.userId),
    userPermissionIdx: index("investigation_members_user_permission_idx").on(table.userId, table.permission),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "investigation_members_investigation_fk",
    }),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "investigation_members_user_fk",
    }),
    grantedByFk: foreignKey({
      columns: [table.grantedBy],
      foreignColumns: [users.id],
      name: "investigation_members_granted_by_fk",
    }),
  }),
);

export const evidence = mysqlTable(
  "evidence",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    uploadedBy: int("uploadedBy").notNull(),
    objectKey: varchar("objectKey", { length: 512 }),
    kind: varchar("kind", { length: 32 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 160 }),
    sizeBytes: int("sizeBytes"),
    mediaHash: varchar("mediaHash", { length: 128 }),
    metadata: json("metadata"),
    note: text("note"),
    annotations: json("annotations"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    investigationTimeIdx: index("evidence_investigation_time_idx").on(table.investigationId, table.createdAt),
    investigationHashIdx: index("evidence_investigation_hash_idx").on(table.investigationId, table.mediaHash),
    uploadedByIdx: index("evidence_uploaded_by_idx").on(table.uploadedBy),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "evidence_investigation_fk",
    }),
    uploadedByFk: foreignKey({
      columns: [table.uploadedBy],
      foreignColumns: [users.id],
      name: "evidence_uploaded_by_fk",
    }),
  }),
);

export const rcaResults = mysqlTable(
  "rca_results",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    schemaVersion: varchar("schemaVersion", { length: 64 }).notNull(),
    promptVersion: varchar("promptVersion", { length: 64 }).notNull(),
    validatorVersion: varchar("validatorVersion", { length: 64 }).notNull(),
    validatedJson: json("validatedJson").notNull(),
    provider: varchar("provider", { length: 80 }),
    modelId: varchar("modelId", { length: 180 }),
    inputTokens: int("inputTokens"),
    outputTokens: int("outputTokens"),
    costUsd: decimal("costUsd", { precision: 20, scale: 10 }),
    isSuperseded: int("isSuperseded").default(0).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    investigationTimeIdx: index("rca_results_investigation_time_idx").on(table.investigationId, table.createdAt),
    currentIdx: index("rca_results_current_idx").on(table.investigationId, table.isSuperseded, table.createdAt),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "rca_results_investigation_fk",
    }),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "rca_results_created_by_fk",
    }),
  }),
);

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", ["USER", "ASSISTANT", "SYSTEM"]).notNull(),
    content: text("content").notNull(),
    rcaResultId: varchar("rcaResultId", { length: 36 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    investigationTimeIdx: index("chat_messages_investigation_time_idx").on(table.investigationId, table.createdAt),
    userTimeIdx: index("chat_messages_user_time_idx").on(table.userId, table.createdAt),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "chat_messages_investigation_fk",
    }),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "chat_messages_user_fk",
    }),
    rcaResultFk: foreignKey({
      columns: [table.rcaResultId],
      foreignColumns: [rcaResults.id],
      name: "chat_messages_rca_result_fk",
    }),
  }),
);

export const correctiveActions = mysqlTable(
  "corrective_actions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    rcaResultId: varchar("rcaResultId", { length: 36 }),
    description: text("description").notNull(),
    reason: text("reason"),
    specific: text("specific"),
    measurable: text("measurable"),
    achievable: text("achievable"),
    relevant: text("relevant"),
    timeBound: text("timeBound"),
    priority: varchar("priority", { length: 32 }),
    ownerId: int("ownerId"),
    dueAt: timestamp("dueAt"),
    status: mysqlEnum("status", ["PLANNED", "IN_PROGRESS", "DONE", "CANCELLED"]).default("PLANNED").notNull(),
    kpi: text("kpi"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => ({
    investigationStatusDueIdx: index("corrective_actions_investigation_status_due_idx").on(table.investigationId, table.status, table.dueAt),
    ownerIdx: index("corrective_actions_owner_idx").on(table.ownerId),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "corrective_actions_investigation_fk",
    }),
    rcaResultFk: foreignKey({
      columns: [table.rcaResultId],
      foreignColumns: [rcaResults.id],
      name: "corrective_actions_rca_result_fk",
    }),
    ownerFk: foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "corrective_actions_owner_fk",
    }),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "corrective_actions_created_by_fk",
    }),
  }),
);

export const tags = mysqlTable(
  "tags",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspaceId", { length: 36 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    normalizedName: varchar("normalizedName", { length: 120 }).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    workspaceNameUq: uniqueIndex("tags_workspace_normalized_name_uq").on(table.workspaceId, table.normalizedName),
    workspaceIdx: index("tags_workspace_idx").on(table.workspaceId),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "tags_workspace_fk",
    }),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "tags_created_by_fk",
    }),
  }),
);

export const investigationTags = mysqlTable(
  "investigation_tags",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    investigationId: varchar("investigationId", { length: 36 }).notNull(),
    tagId: varchar("tagId", { length: 36 }).notNull(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    pairUq: uniqueIndex("investigation_tags_pair_uq").on(table.investigationId, table.tagId),
    tagIdx: index("investigation_tags_tag_idx").on(table.tagId),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "investigation_tags_investigation_fk",
    }),
    tagFk: foreignKey({
      columns: [table.tagId],
      foreignColumns: [tags.id],
      name: "investigation_tags_tag_fk",
    }),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "investigation_tags_created_by_fk",
    }),
  }),
);

export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    workspaceId: varchar("workspaceId", { length: 36 }),
    actorId: int("actorId"),
    investigationId: varchar("investigationId", { length: 36 }),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 36 }).notNull(),
    action: varchar("action", { length: 96 }).notNull(),
    outcome: mysqlEnum("outcome", ["SUCCESS", "DENIED", "FAILURE"]).default("SUCCESS").notNull(),
    requestId: varchar("requestId", { length: 128 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    workspaceTimeIdx: index("audit_events_workspace_time_idx").on(table.workspaceId, table.createdAt),
    entityTimeIdx: index("audit_events_entity_time_idx").on(table.entityType, table.entityId, table.createdAt),
    actorTimeIdx: index("audit_events_actor_time_idx").on(table.actorId, table.createdAt),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "audit_events_workspace_fk",
    }),
    actorFk: foreignKey({
      columns: [table.actorId],
      foreignColumns: [users.id],
      name: "audit_events_actor_fk",
    }),
    investigationFk: foreignKey({
      columns: [table.investigationId],
      foreignColumns: [investigations.id],
      name: "audit_events_investigation_fk",
    }),
  }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type Investigation = typeof investigations.$inferSelect;
export type InvestigationMember = typeof investigationMembers.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type RcaResult = typeof rcaResults.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type CorrectiveAction = typeof correctiveActions.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type InvestigationTag = typeof investigationTags.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
