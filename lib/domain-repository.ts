import AsyncStorage from "@react-native-async-storage/async-storage";

import { migrateDomainStorage } from "../shared/domain/migration";
import {
  DOMAIN_STORAGE_KEY,
  emptyDomainState,
  type AuditEvent,
  type CauseNode,
  type CorrectiveAction,
  type DomainState,
  type Equipment,
  type Evidence,
  type Hypothesis,
  type Investigation,
  type Measurement,
  type Pump,
  type RcaTask,
  type Symptom,
  type Consequence,
  type TimelineEvent,
} from "../shared/domain/types";
import { emitDomainChanged } from "./domain-events";

export const LEGACY_CASES_STORAGE_KEY = "pumprca.cases.v1";

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const asyncStorageAdapter: StorageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const parseJson = (raw: string | null): unknown => {
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
};

export type RepositoryOptions = { adapter?: StorageAdapter; legacyCases?: unknown };

export class PumpRcaRepository {
  private readonly adapter: StorageAdapter;
  private readonly legacyCases?: unknown;

  constructor(options: RepositoryOptions = {}) {
    this.adapter = options.adapter ?? asyncStorageAdapter;
    this.legacyCases = options.legacyCases;
  }

  async load(): Promise<DomainState> {
    const rawDomain = await this.adapter.getItem(DOMAIN_STORAGE_KEY);
    const rawLegacy = rawDomain ? null : await this.adapter.getItem(LEGACY_CASES_STORAGE_KEY);
    const state = migrateDomainStorage(parseJson(rawDomain), this.legacyCases ?? parseJson(rawLegacy));
    if (!rawDomain || !rawDomain.includes('"equipment"')) await this.save(state);
    return state;
  }

  async getState() { return this.load(); }
  async save(state: DomainState) {
    await this.adapter.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(state));
    emitDomainChanged();
  }

  async createPump(input: Omit<Pump, "id" | "createdAt" | "updatedAt">): Promise<Pump> {
    const state = await this.load();
    const timestamp = now();
    const pump: Pump = { ...input, id: id("pump"), createdAt: timestamp, updatedAt: timestamp };
    state.pumps.push(pump);
    if (!state.equipment.some((item) => item.id === pump.id)) {
      state.equipment.push(this.equipmentFromPump(pump));
    }
    await this.save(state);
    return pump;
  }

  private equipmentFromPump(pump: Pump): Equipment {
    return {
      id: pump.id,
      legacyPumpId: pump.id,
      assetTag: pump.assetTag,
      groupId: "pumps",
      groupLabel: "Насосы",
      kind: "dynamic",
      model: pump.equipmentType,
      location: pump.location,
      manufacturer: pump.manufacturer,
      serialNumber: pump.serialNumber,
      characteristics: pump.metadata,
      capabilities: [],
      components: [],
      measurements: [],
      history: [],
      createdAt: pump.createdAt,
      updatedAt: pump.updatedAt,
    };
  }

  async createEquipment(input: Omit<Equipment, "id" | "createdAt" | "updatedAt">): Promise<Equipment> {
    const state = await this.load();
    const timestamp = now();
    const equipment: Equipment = { ...input, id: id("equipment"), createdAt: timestamp, updatedAt: timestamp };
    state.equipment.push(equipment);
    // Keep legacy flows, reports and investigation links working while the universal model rolls out.
    state.pumps.push({
      id: equipment.id,
      assetTag: equipment.assetTag,
      equipmentType: equipment.model,
      location: equipment.location,
      manufacturer: equipment.manufacturer,
      serialNumber: equipment.serialNumber,
      model: equipment.model,
      metadata: equipment.characteristics,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.save(state);
    return equipment;
  }

  async saveEquipment(equipment: Equipment) {
    const state = await this.load();
    const index = state.equipment.findIndex((item) => item.id === equipment.id);
    if (index < 0) throw new Error(`Оборудование не найдено: ${equipment.id}`);
    state.equipment[index] = { ...equipment, updatedAt: now() };
    const pumpIndex = state.pumps.findIndex((item) => item.id === equipment.id);
    if (pumpIndex >= 0) state.pumps[pumpIndex] = { ...state.pumps[pumpIndex], assetTag: equipment.assetTag, equipmentType: equipment.model, location: equipment.location, manufacturer: equipment.manufacturer, serialNumber: equipment.serialNumber, metadata: equipment.characteristics, updatedAt: now() };
    await this.save(state);
    return state.equipment[index];
  }

  async deletePumps(pumpIds: string[]) {
    const ids = new Set(pumpIds);
    if (!ids.size) return { deleted: 0 };
    const state = await this.load();
    const removed = state.pumps.filter((pump) => ids.has(pump.id));
    const affectedInvestigations = state.investigations.filter((item) => item.pumpId && ids.has(item.pumpId));
    state.pumps = state.pumps.filter((pump) => !ids.has(pump.id));
    state.equipment = state.equipment.filter((item) => !ids.has(item.id));
    state.investigations = state.investigations.map((item) => ids.has(item.pumpId ?? "")
      ? { ...item, pumpId: undefined, updatedAt: now() }
      : item);
    await this.save(state);

    // The legacy case list is still used by the main «Кейсы» screen. Keep the cases,
    // but detach the removed pump by its stable legacy id / asset tag so it cannot reappear.
    const rawLegacy = await this.adapter.getItem(LEGACY_CASES_STORAGE_KEY);
    const legacyCases = parseJson(rawLegacy);
    if (Array.isArray(legacyCases)) {
      const affectedLegacyIds = new Set(affectedInvestigations.map((item) => item.legacyCaseId ?? item.id));
      const assetTags = new Set(removed.map((pump) => pump.assetTag));
      const nextLegacy = legacyCases.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const item = entry as Record<string, unknown>;
        if (affectedLegacyIds.has(textValue(item.id)) || assetTags.has(textValue(item.assetTag))) {
          const { pumpId: _pumpId, ...rest } = item;
          return { ...rest, pumpRemovedAt: now() };
        }
        return item;
      });
      await this.adapter.setItem(LEGACY_CASES_STORAGE_KEY, JSON.stringify(nextLegacy));
    }
    return { deleted: removed.length };
  }

  async createInvestigation(input: Pick<Investigation, "title" | "narrative"> & Partial<Pick<Investigation, "pumpId" | "severity" | "tags">>): Promise<Investigation> {
    const state = await this.load();
    const timestamp = now();
    const investigation: Investigation = {
      id: id("investigation"), pumpId: input.pumpId, title: input.title, narrative: input.narrative,
      severity: input.severity, status: "DRAFT", tags: input.tags ?? [], evidenceIds: [], hypothesisIds: [],
      taskIds: [], causeNodeIds: [], actionIds: [], createdAt: timestamp, updatedAt: timestamp, statusChangedAt: timestamp,
    };
    state.investigations.push(investigation);
    await this.save(state);
    return investigation;
  }

  async getInvestigation(investigationId: string) {
    const state = await this.load();
    return state.investigations.find((item) => item.id === investigationId);
  }

  async listInvestigations() {
    const state = await this.load();
    return state.investigations;
  }

  async replaceInvestigation(investigation: Investigation) {
    const state = await this.load();
    const index = state.investigations.findIndex((item) => item.id === investigation.id);
    if (index < 0) throw new Error(`Investigation not found: ${investigation.id}`);
    if (state.investigations[index].status !== investigation.status) {
      throw new Error("Investigation status must be changed through the workflow service.");
    }
    state.investigations[index] = { ...investigation, updatedAt: now() };
    await this.save(state);
    return state.investigations[index];
  }

  async commitInvestigationTransition(input: {
    investigationId: string;
    expectedStatus: Investigation["status"];
    nextStatus: Investigation["status"];
    auditEvent: AuditEvent;
  }) {
    const state = await this.load();
    const index = state.investigations.findIndex((item) => item.id === input.investigationId);
    if (index < 0) throw new Error(`Investigation not found: ${input.investigationId}`);
    const current = state.investigations[index];
    if (current.status !== input.expectedStatus) {
      throw new Error("Investigation changed before transition; reload and try again.");
    }
    if (input.auditEvent.investigationId !== input.investigationId) {
      throw new Error("Audit event investigation mismatch.");
    }
    state.investigations[index] = {
      ...current,
      status: input.nextStatus,
      statusChangedAt: now(),
      updatedAt: now(),
    };
    state.auditLog.push({ ...input.auditEvent });
    await this.save(state);
    return state.investigations[index];
  }

  private async upsert<T extends { id: string }>(collection: T[], item: T) {
    const index = collection.findIndex((entry) => entry.id === item.id);
    if (index < 0) collection.push(item); else collection[index] = item;
  }

  async saveEvidence(item: Evidence) { return this.saveEntity("evidence", item); }
  async deleteEvidence(evidenceId: string, investigationId: string) {
    const state = await this.load();
    const evidence = state.evidence.find((item) => item.id === evidenceId && item.investigationId === investigationId);
    if (!evidence) throw new Error("Доказательство не найдено или недоступно.");
    state.evidence = state.evidence.filter((item) => item.id !== evidenceId);
    const investigation = state.investigations.find((item) => item.id === investigationId);
    if (investigation) {
      investigation.evidenceIds = investigation.evidenceIds.filter((item) => item !== evidenceId);
      investigation.updatedAt = now();
    }
    await this.save(state);
    return evidence;
  }
  async saveMeasurement(item: Measurement) { return this.saveEntity("measurements", item); }
  async saveHypothesis(item: Hypothesis) { return this.saveEntity("hypotheses", item); }
  async saveTask(item: RcaTask) { return this.saveEntity("tasks", item); }
  async saveCause(item: CauseNode) { return this.saveEntity("causes", item); }
  async saveAction(item: CorrectiveAction) { return this.saveEntity("actions", item); }
  async saveSymptom(item: Symptom) { return this.saveEntity("symptoms", item); }
  async saveConsequence(item: Consequence) { return this.saveEntity("consequences", item); }
  async saveTimelineEvent(item: TimelineEvent) { return this.saveEntity("timeline", item); }

  private async saveEntity<K extends "evidence" | "measurements" | "hypotheses" | "tasks" | "causes" | "actions" | "symptoms" | "consequences" | "timeline", T extends DomainState[K][number]>(collection: K, item: T) {
    const state = await this.load();
    await this.upsert(state[collection] as T[], item);
    await this.save(state);
    return item;
  }

  async appendAudit(event: AuditEvent) {
    const state = await this.load();
    state.auditLog.push(event);
    await this.save(state);
    return event;
  }

  async getAuditEvents(investigationId: string) {
    const state = await this.load();
    return state.auditLog
      .filter((event) => event.investigationId === investigationId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}

export function createPumpRcaRepository(options: RepositoryOptions = {}) { return new PumpRcaRepository(options); }
export { emptyDomainState };

function textValue(value: unknown) { return typeof value === "string" ? value : ""; }
