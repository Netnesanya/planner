import { Component, inject, OnDestroy, signal } from "@angular/core";
import { CalendarSubscriptionsComponent } from "./calendar-subscriptions.component";
import { FormsModule } from "@angular/forms";
import { PlannerService } from "../planner.service";
import { addDays, dateKey, LOCAL_USER } from "../models";
import {
  CalendarPreview,
  exportCalendar,
  ImportRow,
  MAX_CALENDAR_BYTES,
  previewImport,
} from "./calendar-transfer";
import { validateRange } from "./calendar-time";
@Component({
  selector: "app-calendar-transfer",
  standalone: true,
  imports: [FormsModule, CalendarSubscriptionsComponent],
  templateUrl: "./calendar-transfer.component.html",
  styleUrl: "./calendar-transfer.component.scss",
})
export class CalendarTransferComponent implements OnDestroy {
  readonly store = inject(PlannerService);
  mode: "import" | "export" | "subscribe" = "import";
  from = dateKey();
  to = addDays(this.from, 83);
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  zones = [
    ...new Set([
      this.zone,
      "UTC",
      "Europe/Belgrade",
      "Europe/London",
      "Europe/Moscow",
      "America/New_York",
      "Asia/Tokyo",
    ]),
  ];
  listId = this.store.lists()[0]?.id || "";
  listIds = this.store.lists().map((l) => l.id);
  completed = false;
  milestones = true;
  fileName = "";
  raw = "";
  reading = signal(false);
  error = signal("");
  success = signal("");
  preview = signal<CalendarPreview | null>(null);
  rows = signal<ImportRow[]>([]);
  exportReport = signal<{
    count: number;
    issues: { title: string; reason: string }[];
  } | null>(null);
  private worker?: Worker;
  private timeout?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private account = "";
  get selectedCount() {
    return this.rows().filter((r) => r.selected && r.kind !== "same").length;
  }
  get newCount() {
    return this.rows().filter((r) => r.kind === "new").length;
  }
  get updateCount() {
    return this.rows().filter((r) => r.kind === "update").length;
  }
  get sameCount() {
    return this.rows().filter((r) => r.kind === "same").length;
  }
  get contextChanged() {
    return (
      !!this.preview() &&
      (this.account !== (this.store.user()?.id || LOCAL_USER) ||
        !this.store.lists().some((l) => l.id === this.listId))
    );
  }
  ngOnDestroy() {
    this.cancel();
  }
  private cancel() {
    this.generation++;
    this.worker?.terminate();
    this.worker = undefined;
    clearTimeout(this.timeout);
    this.reading.set(false);
  }
  clearPreview() {
    this.cancel();
    this.preview.set(null);
    this.rows.set([]);
    this.error.set("");
    this.success.set("");
    this.exportReport.set(null);
  }
  switchMode(mode: "import" | "export" | "subscribe") {
    this.clearPreview();
    this.mode = mode;
  }
  reset() {
    this.clearPreview();
    this.raw = "";
    this.fileName = "";
  }
  async fileChanged(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    this.reset();
    if (!/\.ics$/i.test(file.name)) {
      this.error.set("Выберите файл с расширением .ics.");
      return;
    }
    if (file.size > MAX_CALENDAR_BYTES) {
      this.error.set("Файл больше 2 МБ. Экспортируйте меньший календарь.");
      return;
    }
    this.fileName = file.name;
    const generation = this.generation;
    this.reading.set(true);
    try {
      const raw = await file.text();
      if (generation !== this.generation) return;
      this.raw = raw;
      this.parse();
    } catch {
      this.reading.set(false);
      this.error.set(
        "Не удалось прочитать файл. Попробуйте выбрать его ещё раз.",
      );
    }
  }
  parse() {
    this.clearPreview();
    try {
      validateRange(this.from, this.to, this.zone);
      if (!this.raw || !this.store.lists().some((l) => l.id === this.listId))
        throw new Error("Выберите файл и список для импорта.");
      this.account = this.store.user()?.id || LOCAL_USER;
      const generation = this.generation;
      this.reading.set(true);
      this.worker = new Worker(new URL("./calendar.worker", import.meta.url), {
        type: "module",
      });
      this.timeout = setTimeout(() => {
        this.cancel();
        this.error.set(
          "Обработка заняла слишком много времени. Выберите меньший файл или диапазон.",
        );
      }, 10000);
      this.worker.onmessage = ({
        data,
      }: MessageEvent<{ result?: CalendarPreview; error?: string }>) => {
        if (generation !== this.generation) return;
        this.cancel();
        if (data.error) {
          this.error.set(data.error);
          return;
        }
        if (!data.result) {
          this.error.set("Не удалось прочитать события.");
          return;
        }
        this.rows.set(
          previewImport(data.result.entries, this.store.tasks(), this.listId),
        );
        this.preview.set(data.result);
      };
      this.worker.onerror = () => {
        this.cancel();
        this.error.set(
          "Не удалось обработать календарь. Проверьте файл или обновите страницу.",
        );
      };
      this.worker.postMessage({
        raw: this.raw,
        range: { from: this.from, to: this.to, zone: this.zone },
      });
    } catch (error) {
      this.cancel();
      this.error.set((error as Error).message);
    }
  }
  toggleRow(key: string, selected: boolean) {
    this.rows.update((rows) =>
      rows.map((row) => (row.key === key ? { ...row, selected } : row)),
    );
  }
  selectNew() {
    this.rows.update((rows) =>
      rows.map((row) => ({ ...row, selected: row.kind === "new" })),
    );
  }
  toggleList(id: string, selected: boolean) {
    this.listIds = selected
      ? [...new Set([...this.listIds, id])]
      : this.listIds.filter((value) => value !== id);
    this.exportReport.set(null);
  }
  previous(row: ImportRow) {
    if (!row.before) return "";
    const task = JSON.parse(row.before);
    return `${task.title} · ${task.due_date || "Без даты"} · ${task.start_time || "Весь день"}${task.start_time ? ` · ${task.duration} мин` : ""}`;
  }
  async apply() {
    if (!this.selectedCount || this.contextChanged) return;
    this.error.set("");
    const count = this.selectedCount;
    const ok = await this.store.importCalendar(
      this.rows(),
      this.listId,
      this.account,
    );
    if (!ok) {
      this.error.set(
        this.store.error() || "Импорт не выполнен. Попробуйте ещё раз.",
      );
      return;
    }
    if (this.account !== (this.store.user()?.id || LOCAL_USER)) {
      this.clearPreview();
      return;
    }
    const entries = this.preview()?.entries || [];
    this.rows.set(previewImport(entries, this.store.tasks(), this.listId));
    this.success.set(
      `Готово: сохранено ${count} событий. Их можно найти в выбранном списке и календаре.`,
    );
  }
  download() {
    this.error.set("");
    this.success.set("");
    try {
      if (!this.listIds.length)
        throw new Error("Выберите хотя бы один список.");
      const result = exportCalendar(this.store.tasks(), {
        from: this.from,
        to: this.to,
        zone: this.zone,
        listIds: this.listIds,
        completed: this.completed,
        milestones: this.milestones,
      });
      this.exportReport.set(result);
      if (!result.count) return;
      const url = URL.createObjectURL(
        new Blob([result.text], { type: "text/calendar;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `flow-${this.from}-${this.to}.ics`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.success.set(
        `Скачано событий: ${result.count}. Импортируйте файл в Apple или Google Calendar.`,
      );
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}
