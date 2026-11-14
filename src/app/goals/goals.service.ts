import { Injectable, effect, inject, signal } from "@angular/core";
import { PlannerService } from "../planner.service";
import { emptyGoals, GoalsData, validateGoals } from "./goals";
const KEY = "flow.goals.local.v1";
@Injectable({ providedIn: "root" })
export class GoalsService {
  readonly planner = inject(PlannerService);
  readonly data = signal<GoalsData>(emptyGoals());
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly ready = signal(false);
  private revision = 0;
  private storageDirty = false;
  private generation = 0;
  private owner = "";
  constructor() {
    effect(() => {
      const owner = this.planner.user()?.id || "local";
      void this.load(owner);
    });
    window.addEventListener("storage", (event) => {
      if (event.key === "flow.goals.changed" && this.owner === "local") {
        if (this.busy()) this.storageDirty = true;
        else this.refreshLocal();
      }
    });
  }
  private database?: Promise<IDBDatabase>;
  private openDatabase() {
    return (this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("flow-goals", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("books");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Закройте старые вкладки целей и обновите страницу."));
    }));
  }
  private legacyRecord() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { revision: 0, data: emptyGoals() };
    const record = JSON.parse(raw);
    if (!Number.isSafeInteger(record.revision) || record.revision < 0)
      throw new Error("Некорректная версия хранилища целей.");
    return { revision: record.revision, data: validateGoals(record.data) };
  }
  private async readLocal() {
    const db = await this.openDatabase();
    return new Promise<{ revision: number; data: GoalsData }>(
      (resolve, reject) => {
        const transaction = db.transaction("books", "readonly");
        const request = transaction.objectStore("books").get("local");
        request.onsuccess = () => {
          try {
            const record = request.result || this.legacyRecord();
            validateGoals(record.data);
            resolve(record);
          } catch (error) {
            reject(error);
          }
        };
        request.onerror = () => reject(request.error);
      },
    );
  }
  private async mutateLocal(update: (data: GoalsData) => GoalsData) {
    const db = await this.openDatabase();
    return new Promise<{ revision: number; data: GoalsData }>(
      (resolve, reject) => {
        const transaction = db.transaction("books", "readwrite", {
          durability: "strict",
        });
        const store = transaction.objectStore("books");
        const request = store.get("local");
        let result: { revision: number; data: GoalsData }, failure: unknown;
        request.onsuccess = () => {
          try {
            const current = request.result || this.legacyRecord();
            const data = validateGoals(update(validateGoals(current.data)));
            result = { revision: current.revision + 1, data };
            store.put(result, "local");
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(
            failure ||
              transaction.error ||
              new Error("Не удалось сохранить цели."),
          );
        transaction.onerror = () => {
          failure ||= transaction.error;
        };
      },
    );
  }
  private async refreshLocal() {
    try {
      const current = await this.readLocal();
      if (this.owner !== "local" || current.revision < this.revision) return;
      if (this.busy()) {
        this.storageDirty = true;
        return;
      }
      this.revision = current.revision;
      this.data.set(current.data);
    } catch (error) {
      this.error.set((error as Error).message);
      this.ready.set(false);
    }
  }
  async load(owner = this.planner.user()?.id || "local") {
    const token = ++this.generation;
    this.owner = owner;
    this.loading.set(true);
    this.ready.set(false);
    this.data.set(emptyGoals());
    this.error.set("");
    try {
      let record;
      if (owner === "local") record = await this.readLocal();
      else {
        const client = this.planner.financialClient;
        if (!client)
          throw new Error(
            "Подключение к облаку ещё не готово. Повторите загрузку.",
          );
        const response = await client
          .from("long_goal_books")
          .select("data,revision")
          .eq("owner_id", owner)
          .maybeSingle();
        if (response.error)
          throw new Error(
            "Цели не загрузились. Проверьте сеть и миграцию 005_long_goals.sql. Локальные цели хранятся отдельно.",
          );
        record = response.data || { revision: 0, data: emptyGoals() };
      }
      if (token !== this.generation) return;
      this.revision = record.revision;
      this.data.set(validateGoals(record.data));
      this.ready.set(true);
    } catch (error) {
      if (token === this.generation) this.error.set((error as Error).message);
    } finally {
      if (token === this.generation) this.loading.set(false);
    }
  }
  async change(update: (data: GoalsData) => GoalsData) {
    if (this.busy() || !this.ready()) return false;
    this.busy.set(true);
    this.error.set("");
    const token = this.generation,
      owner = this.owner;
    try {
      let next: GoalsData, revision: number;
      if (owner === "local") {
        const saved = await this.mutateLocal((data) => {
          if (token !== this.generation)
            throw new Error("Пространство изменилось. Повторите действие.");
          return update(data);
        });
        try {
          localStorage.setItem("flow.goals.changed", crypto.randomUUID());
        } catch {
          /* Only a notification; the ledger has already committed. */
        }
        next = saved.data;
        revision = saved.revision;
      } else {
        const client = this.planner.financialClient;
        if (!client) throw new Error("Нет подключения к облаку.");
        next = validateGoals(update(this.data()));
        revision = this.revision + 1;
        const response =
          this.revision === 0
            ? await client
                .from("long_goal_books")
                .insert({ owner_id: owner, data: next, revision })
                .select("revision")
                .single()
            : await client
                .from("long_goal_books")
                .update({ data: next, revision })
                .eq("owner_id", owner)
                .eq("revision", this.revision)
                .select("revision")
                .single();
        if (response.error)
          throw new Error(
            "Ошибка сохранения. Проверьте сеть, обновите цели и повторите действие: возможен конфликт с другой вкладкой.",
          );
      }
      if (token !== this.generation) return false;
      this.data.set(next);
      this.revision = revision;
      return true;
    } catch (error) {
      if (token === this.generation) this.error.set((error as Error).message);
      return false;
    } finally {
      this.busy.set(false);
      if (this.storageDirty && this.owner === "local") {
        this.storageDirty = false;
        this.refreshLocal();
      }
    }
  }
}
