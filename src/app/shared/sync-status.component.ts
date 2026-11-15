import { Component, inject } from "@angular/core";
import { PlannerService } from "../planner.service";
@Component({
  selector: "app-sync-status",
  standalone: true,
  template: ` <div
    class="sync-state"
    role="status"
    [class.failed]="store.syncState() === 'error'"
  >
    <span>{{ label }}</span>
    @if (store.syncState() === "load-error" && store.online()) {
      <button (click)="store.refresh()" [disabled]="store.syncRefreshing()">
        Обновить данные
      </button>
    }
    @if (store.canRetry() && store.online()) {
      <button (click)="store.retrySave()" [disabled]="store.busy()">
        Повторить сохранение
      </button>
    }
    @if (store.cloud() && !store.checkedWrites()) {
      <small
        title="Примените единый файл обновления базы, чтобы включить проверку конфликтов"
        >Базовый режим синхронизации</small
      >
    }
  </div>`,
  styleUrl: "./sync-status.component.scss",
})
export class SyncStatusComponent {
  readonly store = inject(PlannerService);
  get label() {
    if (!this.store.online())
      return this.store.cloud()
        ? "Нет сети · запись в облако приостановлена"
        : "Без сети · локальное сохранение";
    if (this.store.syncState() === "saving") return "Сохраняем…";
    if (this.store.syncState() === "load-error")
      return "Не удалось обновить данные";
    if (this.store.syncState() === "error") return "Не сохранено";
    if (this.store.syncRefreshing() || this.store.loading())
      return "Обновляем данные…";
    return this.store.cloud()
      ? this.store.lastSaved()
        ? "Сохранено в облаке"
        : "Облако подключено"
      : "Сохранено на этом устройстве";
  }
}
