import { Injectable, effect, inject, signal } from "@angular/core";
import { PlannerService } from "../planner.service";
import {
  emptyFinance,
  expandPayments,
  FinanceData,
  validateFinance,
} from "./finance";
const KEY = "flow.finance.local.v1";
@Injectable({ providedIn: "root" })
export class FinanceService {
  readonly planner = inject(PlannerService);
  readonly data = signal<FinanceData>(emptyFinance());
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
      if (event.key === "flow.finance.changed" && this.owner === "local") {
        if (this.busy()) this.storageDirty = true;
        else this.refreshLocal();
      }
    });
  }
  private database?: Promise<IDBDatabase>;
  private openDatabase() {
    return (this.database ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("flow-finance", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("books");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error("Закройте старые вкладки финансов и обновите страницу."),
        );
    }));
  }
  private legacyRecord() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { revision: 0, data: emptyFinance() };
    const record = JSON.parse(raw);
    if (!Number.isSafeInteger(record.revision) || record.revision < 0)
      throw new Error("Некорректная версия финансового хранилища.");
    return { revision: record.revision, data: validateFinance(record.data) };
  }
  private async readLocal() {
    const db = await this.openDatabase();
    return new Promise<{ revision: number; data: FinanceData }>(
      (resolve, reject) => {
        const transaction = db.transaction("books", "readonly");
        const request = transaction.objectStore("books").get("local");
        request.onsuccess = () => {
          try {
            const record = request.result || this.legacyRecord();
            validateFinance(record.data);
            resolve(record);
          } catch (error) {
            reject(error);
          }
        };
        request.onerror = () => reject(request.error);
      },
    );
  }
  private async mutateLocal(update: (data: FinanceData) => FinanceData) {
    const db = await this.openDatabase();
    return new Promise<{ revision: number; data: FinanceData }>(
      (resolve, reject) => {
        const transaction = db.transaction("books", "readwrite", {
          durability: "strict",
        });
        const store = transaction.objectStore("books");
        const request = store.get("local");
        let result: { revision: number; data: FinanceData }, failure: unknown;
        request.onsuccess = () => {
          try {
            const current = request.result || this.legacyRecord();
            const data = validateFinance(
              update(expandPayments(validateFinance(current.data))),
            );
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
              new Error("Не удалось сохранить финансы."),
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
      this.data.set(expandPayments(current.data));
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
    this.data.set(emptyFinance());
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
          .from("finance_books")
          .select("data,revision")
          .eq("owner_id", owner)
          .maybeSingle();
        if (response.error)
          throw new Error(
            "Не удалось загрузить финансы из облака. Проверьте соединение и установку миграции 004_finance.sql. Локальные финансы хранятся отдельно.",
          );
        record = response.data || { revision: 0, data: emptyFinance() };
      }
      if (token !== this.generation) return;
      this.revision = record.revision;
      this.data.set(expandPayments(validateFinance(record.data)));
      this.ready.set(true);
    } catch (error) {
      if (token === this.generation) this.error.set((error as Error).message);
    } finally {
      if (token === this.generation) this.loading.set(false);
    }
  }
  async change(update: (data: FinanceData) => FinanceData) {
    if (this.busy() || !this.ready()) return false;
    this.busy.set(true);
    this.error.set("");
    const token = this.generation,
      owner = this.owner;
    try {
      let next: FinanceData, revision: number;
      if (owner === "local") {
        const saved = await this.mutateLocal((data) => {
          if (token !== this.generation)
            throw new Error("Пространство изменилось. Повторите действие.");
          return update(data);
        });
        try {
          localStorage.setItem("flow.finance.changed", crypto.randomUUID());
        } catch {
          /* Only a notification; the ledger has already committed. */
        }
        next = saved.data;
        revision = saved.revision;
      } else {
        const client = this.planner.financialClient;
        if (!client) throw new Error("Нет подключения к облаку.");
        next = validateFinance(update(expandPayments(this.data())));
        revision = this.revision + 1;
        const response =
          this.revision === 0
            ? await client
                .from("finance_books")
                .insert({ owner_id: owner, data: next, revision })
                .select("revision")
                .single()
            : await client
                .from("finance_books")
                .update({ data: next, revision })
                .eq("owner_id", owner)
                .eq("revision", this.revision)
                .select("revision")
                .single();
        if (response.error)
          throw new Error(
            "Не удалось сохранить: проверьте сеть. Если данные изменены в другой вкладке, обновите финансовый раздел и повторите действие.",
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
