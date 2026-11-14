import { Component, effect, inject, signal, OnDestroy } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PlannerService } from "../planner.service";
import { newCalendarToken, tokenDigest } from "./calendar-capability";
interface Subscription {
  id: string;
  name: string;
  list_ids: string[];
  timezone: string;
  include_completed: boolean;
  include_milestones: boolean;
  revoked_at: string | null;
}
@Component({
  selector: "app-calendar-subscriptions",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./calendar-subscriptions.component.html",
  styleUrl: "./calendar-subscriptions.component.scss",
})
export class CalendarSubscriptionsComponent implements OnDestroy {
  ngOnDestroy() {
    this.generation++;
    this.revealed.set(null);
  }
  readonly store = inject(PlannerService);
  readonly subscriptions = signal<Subscription[]>([]);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal("");
  readonly message = signal("");
  readonly revealed = signal<{ id: string; url: string } | null>(null);
  name = "Мой календарь Flow";
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  listIds: string[] = [];
  completed = false;
  milestones = true;
  consent = false;
  confirmAction = signal<{ id: string; kind: "rotate" | "revoke" } | null>(
    null,
  );
  private generation = 0;
  private owner: string | undefined;
  constructor() {
    effect(() => {
      const owner = this.store.user()?.id;
      if (owner === this.owner) return;
      this.owner = owner;
      this.generation++;
      this.subscriptions.set([]);
      this.revealed.set(null);
      this.error.set("");
      this.message.set("");
      this.confirmAction.set(null);
      this.busy.set(false);
      this.loading.set(false);
      this.listIds = [];
      this.consent = false;
      if (owner) void this.load(this.generation);
    });
  }
  private fail(error: unknown) {
    const e = error as { code?: string; message?: string };
    this.error.set(
      ["PGRST205", "42P01", "PGRST202"].includes(e.code || "")
        ? "Подписки ещё не включены на сервере. Нужны миграция 007 и функция calendar-feed."
        : e.message || "Не удалось выполнить операцию. Попробуйте ещё раз.",
    );
  }
  async load(generation = this.generation) {
    const client = this.store.calendarClient;
    if (!client) return;
    this.error.set("");
    this.loading.set(true);
    try {
      const { data, error } = await client
        .from("calendar_subscriptions")
        .select(
          "id,name,list_ids,timezone,include_completed,include_milestones,revoked_at",
        )
        .order("created_at", { ascending: false });
      if (generation !== this.generation) return;
      if (error) throw error;
      this.subscriptions.set(data || []);
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  toggleList(id: string, checked: boolean) {
    this.listIds = checked
      ? [...new Set([...this.listIds, id])]
      : this.listIds.filter((x) => x !== id);
  }
  listNames(ids: string[]) {
    return ids
      .map(
        (id) =>
          this.store.lists().find((l) => l.id === id)?.name ||
          "Нет доступа к списку",
      )
      .join(", ");
  }
  async create() {
    await this.mutate("create");
  }
  async confirm() {
    const action = this.confirmAction();
    if (action) await this.mutate(action.kind, action.id);
  }
  private async mutate(kind: "create" | "rotate" | "revoke", id?: string) {
    if (this.busy()) return;
    const client = this.store.calendarClient;
    if (!client) return;
    const generation = this.generation;
    this.busy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      if (kind === "create") {
        if (!this.consent || !this.listIds.length || !this.name.trim())
          throw Error(
            "Выберите списки, название и подтвердите доступ по ссылке.",
          );
        new Intl.DateTimeFormat("en", { timeZone: this.zone }).format();
      }
      const token = kind === "revoke" ? "" : newCalendarToken();
      const digest = token ? await tokenDigest(token) : "";
      if (generation !== this.generation) return;
      const result =
        kind === "create"
          ? await client.rpc("create_calendar_subscription", {
              subscription_name: this.name,
              digest,
              selected_lists: this.listIds,
              zone: this.zone,
              completed: this.completed,
              milestones: this.milestones,
            })
          : kind === "rotate"
            ? await client.rpc("rotate_calendar_subscription", {
                subscription_id: id,
                digest,
              })
            : await client.rpc("revoke_calendar_subscription", {
                subscription_id: id,
              });
      if (generation !== this.generation) return;
      if (result.error) throw result.error;
      this.confirmAction.set(null);
      if (kind === "revoke") {
        if (this.revealed()?.id === id) this.revealed.set(null);
        this.message.set(
          "Ссылка отозвана. Уже скачанные события могут остаться в календарном приложении.",
        );
      } else {
        const url = new URL(
          this.store.config.supabaseUrl + "/functions/v1/calendar-feed",
        );
        url.searchParams.set("token", token);
        this.revealed.set({ id: id || result.data, url: url.href });
        this.message.set(
          kind === "rotate"
            ? "Новая ссылка готова. Старая больше не работает."
            : "Подписка создана.",
        );
      }
      await this.load(generation);
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
  async copy() {
    const value = this.revealed();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.url);
      this.message.set("Ссылка скопирована.");
    } catch {
      this.error.set(
        "Не удалось скопировать автоматически. Выделите и скопируйте ссылку в поле.",
      );
    }
  }
}
