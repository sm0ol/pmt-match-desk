import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DraftLedger } from "../domain/types";
import { discardDraftOperations } from "./manualJournal";

interface PmtDatabase extends DBSchema {
  drafts: {
    key: string;
    value: DraftLedger;
    indexes: { "by-updated": string };
  };
  meta: {
    key: string;
    value: string;
  };
}

export interface DraftRepository {
  get(id: string): Promise<DraftLedger | undefined>;
  list(): Promise<DraftLedger[]>;
  save(ledger: DraftLedger): Promise<void>;
  saveAndActivate(ledger: DraftLedger): Promise<void>;
  clear(id: string): Promise<void>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  close(): Promise<void>;
}

export function createDraftRepository(databaseName = "pmt-thread-creator"): DraftRepository {
  let databasePromise: Promise<IDBPDatabase<PmtDatabase>> | null = null;
  const database = () => {
    databasePromise ??= openDB<PmtDatabase>(databaseName, 1, {
      upgrade(db) {
        const drafts = db.createObjectStore("drafts", { keyPath: "id" });
        drafts.createIndex("by-updated", "updatedAt");
        db.createObjectStore("meta");
      },
    });
    return databasePromise;
  };

  return {
    async get(id) {
      return (await database()).get("drafts", id);
    },
    async list() {
      const values = await (await database()).getAllFromIndex("drafts", "by-updated");
      return values.reverse();
    },
    async save(ledger) {
      await (await database()).put("drafts", structuredClone(ledger));
    },
    async saveAndActivate(ledger) {
      const db = await database();
      const transaction = db.transaction(["drafts", "meta"], "readwrite");
      await transaction.objectStore("drafts").put(structuredClone(ledger));
      await transaction.objectStore("meta").put(ledger.id, "activeDraftId");
      await transaction.done;
    },
    async clear(id) {
      const db = await database();
      const transaction = db.transaction(["drafts", "meta"], "readwrite");
      await transaction.objectStore("drafts").delete(id);
      const activeId = await transaction.objectStore("meta").get("activeDraftId");
      if (activeId === id) await transaction.objectStore("meta").delete("activeDraftId");
      await transaction.done;
      discardDraftOperations(id);
    },
    async getActiveId() {
      return (await (await database()).get("meta", "activeDraftId")) ?? null;
    },
    async setActiveId(id) {
      const db = await database();
      if (id === null) await db.delete("meta", "activeDraftId");
      else await db.put("meta", id, "activeDraftId");
    },
    async close() {
      if (!databasePromise) return;
      (await databasePromise).close();
      databasePromise = null;
    },
  };
}
