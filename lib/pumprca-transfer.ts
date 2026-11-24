import type { DomainState } from "../shared/domain/types";
import { DOMAIN_SCHEMA_VERSION, emptyDomainState } from "../shared/domain/types";
import { migrateDomainStorage } from "../shared/domain/migration";

export const PUMPRCA_FORMAT = "pumprca" as const;
export type PumpRcaArchive = {
  manifest: { format: typeof PUMPRCA_FORMAT; schemaVersion: number; appVersion: string; createdAt: string; updatedAt: string };
  investigation: DomainState["investigations"][number];
  pump?: DomainState["pumps"][number];
  evidence: DomainState["evidence"];
  measurements: DomainState["measurements"];
  hypotheses: DomainState["hypotheses"];
  causes: DomainState["causes"];
  tasks: DomainState["tasks"];
  actions: DomainState["actions"];
  symptoms: DomainState["symptoms"];
  consequences: DomainState["consequences"];
  timeline: DomainState["timeline"];
  audit: DomainState["auditLog"];
};

const now = () => new Date().toISOString();
export function exportInvestigation(state: DomainState, investigationId: string, appVersion = "1.0.0"): PumpRcaArchive {
  const investigation = state.investigations.find((item) => item.id === investigationId);
  if (!investigation) throw new Error("Investigation not found");
  const ids = new Set([investigationId]);
  const belongs = <T extends { investigationId: string }>(items: T[]) => items.filter((item) => ids.has(item.investigationId));
  const archive: PumpRcaArchive = {
    manifest: { format: PUMPRCA_FORMAT, schemaVersion: DOMAIN_SCHEMA_VERSION, appVersion, createdAt: now(), updatedAt: now() },
    investigation,
    pump: state.pumps.find((item) => item.id === investigation.pumpId),
    evidence: belongs(state.evidence), measurements: belongs(state.measurements), hypotheses: belongs(state.hypotheses), causes: belongs(state.causes), tasks: belongs(state.tasks), actions: belongs(state.actions), symptoms: belongs(state.symptoms), consequences: belongs(state.consequences), timeline: belongs(state.timeline), audit: state.auditLog.filter((item) => item.investigationId === investigationId),
  };
  return archive;
}
export function serializeArchive(archive: PumpRcaArchive) { return JSON.stringify(archive, null, 2); }
export function parseArchive(raw: string): PumpRcaArchive {
  const parsed = JSON.parse(raw) as Partial<PumpRcaArchive>;
  if (parsed.manifest?.format !== PUMPRCA_FORMAT || !parsed.investigation?.id) throw new Error("Неверный формат .pumprca");
  return { ...parsed, manifest: parsed.manifest, evidence: parsed.evidence ?? [], measurements: parsed.measurements ?? [], hypotheses: parsed.hypotheses ?? [], causes: parsed.causes ?? [], tasks: parsed.tasks ?? [], actions: parsed.actions ?? [], symptoms: parsed.symptoms ?? [], consequences: parsed.consequences ?? [], timeline: parsed.timeline ?? [], audit: parsed.audit ?? [] } as PumpRcaArchive;
}
export function importArchive(state: DomainState, archive: PumpRcaArchive): DomainState {
  const next = structuredClone ? structuredClone(state) : JSON.parse(JSON.stringify(state)) as DomainState;
  const replace = <T extends { id: string }>(collection: T[], items: T[]) => { for (const item of items) { const index = collection.findIndex((entry) => entry.id === item.id); if (index >= 0) collection[index] = item; else collection.push(item); } };
  if (archive.pump) replace(next.pumps, [archive.pump]);
  replace(next.investigations, [archive.investigation]); replace(next.evidence, archive.evidence); replace(next.measurements, archive.measurements); replace(next.hypotheses, archive.hypotheses); replace(next.causes, archive.causes); replace(next.tasks, archive.tasks); replace(next.actions, archive.actions); replace(next.symptoms, archive.symptoms); replace(next.consequences, archive.consequences); replace(next.timeline, archive.timeline); replace(next.auditLog, archive.audit);
  return migrateDomainStorage(next);
}
export function makeBackup(state: DomainState, appVersion = "1.0.0") { return JSON.stringify({ manifest: { format: PUMPRCA_FORMAT, schemaVersion: DOMAIN_SCHEMA_VERSION, appVersion, createdAt: now(), updatedAt: now(), backup: true }, state }, null, 2); }
export function restoreBackup(raw: string): DomainState { const parsed = JSON.parse(raw) as { state?: unknown }; if (!parsed.state) throw new Error("Неверная резервная копия «Надёжкин»"); return migrateDomainStorage(parsed.state) ?? emptyDomainState(); }
