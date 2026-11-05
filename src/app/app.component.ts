import { Component, HostListener, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { PlannerService } from "./planner.service";
import { FocusService } from "./focus.service";
import { IconComponent } from "./icon.component";
import {
  addDays,
  COLORS,
  dateKey,
  makeTask,
  parseDate,
  Task,
  TaskList,
} from "./models";
import { TaskOpenRequest } from "./shared/task-view.base";
import { ListViewComponent } from "./views/list-view.component";
import { KanbanViewComponent } from "./views/kanban-view.component";
import { CalendarViewComponent } from "./views/calendar-view.component";
import { TimelineViewComponent } from "./views/timeline-view.component";
import { StatisticsViewComponent } from "./views/statistics-view.component";
import { HistoryViewComponent } from "./views/history-view.component";
import { FocusViewComponent } from "./views/focus-view.component";
import { TodaySummaryComponent } from "./views/today-summary.component";
import { CycleViewComponent } from "./views/cycle-view.component";
import { TaskEditorComponent } from "./editor/task-editor.component";
import { FinanceViewComponent } from "./finance/finance-view.component";
type View = "list" | "kanban" | "calendar" | "timeline";
@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ListViewComponent,
    KanbanViewComponent,
    CalendarViewComponent,
    TimelineViewComponent,
    StatisticsViewComponent,
    HistoryViewComponent,
    FocusViewComponent,
    TodaySummaryComponent,
    TaskEditorComponent,
    CycleViewComponent,
    FinanceViewComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.scss",
})
export class AppComponent {
  readonly store = inject(PlannerService);
  readonly focus = inject(FocusService);
  view: View = (["list", "kanban", "calendar", "timeline"].includes(
    this.store.preferences().view,
  )
    ? this.store.preferences().view
    : "list") as View;
  area:
    "tasks" | "stats" | "history" | "focus" | "cycles" | "finance" =
    this.store.preferences().mode === "finance"
      ? "finance"
      : this.store.preferences().mode === "cycles"
          ? "cycles"
          : "tasks";
  pendingCycleId: string | null = null;
  scope = "today";
  search = "";
  priorityFilter = "all";
  mobileNav = false;
  editor: Task | null = null;
  modal: "settings" | "list" | "share" | null = null;
  confirm: "clear" | "import" | null = null;
  settingsTab: "general" | "account" = "general";
  listEdit: TaskList | null = null;
  listName = "";
  listColor = COLORS[0];
  colors = COLORS;
  shareTarget: TaskList | null = null;
  memberEmail = "";
  members: { user_id: string; email: string }[] = [];
  configUrl = this.store.config.supabaseUrl;
  configKey = this.store.config.supabaseKey;
  authEmail = "";
  authPassword = "";
  register = false;
  importRaw = "";
  returnFocus: HTMLElement | null = null;
  views: { id: View; icon: string; label: string }[] = [
    { id: "list", icon: "list", label: "Список" },
    { id: "kanban", icon: "kanban", label: "Канбан" },
    { id: "calendar", icon: "calendar", label: "Календарь" },
    { id: "timeline", icon: "timeline", label: "Таймлайн" },
  ];
  get today() {
    return dateKey();
  }
  dateLabel(
    date: string,
    opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
  ) {
    return parseDate(date).toLocaleDateString("ru-RU", opts);
  }
  get headerTitle() {
    if (this.area === "finance") return "Финансы";
    if (this.area === "cycles") return "12 недель";
    if (this.area === "stats") return "Ваш прогресс";
    if (this.area === "history") return "Выполненные задачи";
    if (this.area === "focus") return "Время для фокуса";
    if (this.scope === "today") return "Сегодня";
    if (this.scope === "week") return "Ближайшие 7 дней";
    if (this.scope === "all")
      return this.view === "calendar"
        ? "Календарь"
        : this.view === "timeline"
          ? "Таймлайн"
          : "Все задачи";
    if (this.scope.startsWith("goal:"))
      return (
        this.milestoneTags.find((g) => g.id === this.scope.slice(5))?.title ||
        "Майлстоун"
      );
    if (this.scope.startsWith("tag:")) return "#" + this.scope.slice(4);
    return this.listById(this.scope)?.name || "Все задачи";
  }
  get milestoneTags() {
    return this.store.tasks().filter((t) => t.is_milestone);
  }
  get tags() {
    return [...new Set(this.store.tasks().flatMap((t) => t.tags))].sort();
  }
  listById(id: string) {
    return this.store.lists().find((l) => l.id === id);
  }
  count(scope: string) {
    return this.store
      .tasks()
      .filter(
        (t) =>
          t.status !== "done" &&
          (scope === "today"
            ? t.due_date === this.today
            : scope === "week"
              ? !!t.due_date &&
                t.due_date >= this.today &&
                t.due_date <= addDays(this.today, 6)
              : scope === "all"
                ? true
                : t.list_id === scope),
      ).length;
  }
  get filteredTasks() {
    const q = this.search.trim().toLowerCase();
    return this.store
      .tasks()
      .filter((t) => {
        if (
          q &&
          ![t.title, t.notes, ...t.tags].join(" ").toLowerCase().includes(q)
        )
          return false;
        if (
          this.priorityFilter !== "all" &&
          t.priority !== Number(this.priorityFilter)
        )
          return false;
        if (this.area === "history") return t.status === "done";
        if (this.scope.startsWith("goal:"))
          return (
            t.goal_id === this.scope.slice(5) || t.id === this.scope.slice(5)
          );
        if (this.scope.startsWith("tag:"))
          return t.tags.includes(this.scope.slice(4));
        if (this.store.lists().some((l) => l.id === this.scope))
          return t.list_id === this.scope;
        if (q || this.view === "calendar" || this.view === "timeline")
          return true;
        if (this.scope === "today")
          return (
            !!t.due_date &&
            t.due_date <= this.today &&
            (t.status !== "done" ||
              (t.completed_at &&
                dateKey(new Date(t.completed_at)) === this.today))
          );
        if (this.scope === "week")
          return (
            !!t.due_date &&
            t.due_date >= this.today &&
            t.due_date <= addDays(this.today, 6)
          );
        return true;
      })
      .sort((a, b) =>
        this.store.preferences().sort === "manual"
          ? (a.sort_order ?? Date.parse(a.created_at)) -
            (b.sort_order ?? Date.parse(b.created_at))
          : this.store.preferences().sort === "priority"
            ? b.priority - a.priority
            : this.store.preferences().sort === "duration"
              ? b.duration - a.duration
              : (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
                (a.start_time || "99").localeCompare(b.start_time || "99"),
      );
  }
  setMode(mode: "planner" | "cycles" | "finance") {
    this.area = mode === "planner" ? "tasks" : mode;
    this.search = "";
    this.mobileNav = false;
    void this.store.savePreferences({ mode });
  }
  navigate(scope: string, view?: View) {
    void this.store.savePreferences({ mode: "planner" });
    this.scope = scope;
    this.area = "tasks";
    this.search = "";
    this.priorityFilter = "all";
    if (view) this.setView(view);
    this.mobileNav = false;
  }
  allowDrop(event: DragEvent) {
    event.preventDefault();
  }
  async dropIntoList(event: DragEvent, list: TaskList) {
    event.preventDefault();
    const task = this.store
      .tasks()
      .find((t) => t.id === event.dataTransfer?.getData("text/plain"));
    if (task && task.list_id !== list.id)
      await this.store.saveTask({ ...task, list_id: list.id });
  }
  openArea(area: "stats" | "history" | "focus") {
    this.area = area;
    this.search = "";
    this.mobileNav = false;
  }
  setView(view: View) {
    this.view = view;
    void this.store.savePreferences({ view });
  }
  changeShowCompleted() {
    void this.store.savePreferences({
      showCompleted: !this.store.preferences().showCompleted,
    });
  }
  setSort(sort: string) {
    void this.store.savePreferences({ sort });
  }
  handleOpen(request: TaskOpenRequest) {
    this.openTask(request.task, request.due, request.time);
    if (this.editor) {
      if (request.status) this.editor.status = request.status;
      if (request.listId) this.editor.list_id = request.listId;
      if (request.milestone) this.editor.is_milestone = true;
      if (request.goalId) this.editor.goal_id = request.goalId;
    }
    this.pendingCycleId = request.cycleId || null;
  }
  async onTaskSaved(task: Task) {
    const cycle = this.store.cycles().find((c) => c.id === this.pendingCycleId);
    if (task.is_milestone && cycle && !cycle.goal_ids.includes(task.id))
      await this.store.saveCycle({
        ...cycle,
        goal_ids: [...cycle.goal_ids, task.id],
      });
  }
  async removeEmptyList() {
    if (this.listEdit && (await this.store.deleteEmptyList(this.listEdit))) {
      this.closeOverlays();
      this.navigate("all", "list");
    }
  }
  canDeleteList(list: TaskList) {
    return (
      this.store.lists().length > 1 &&
      !this.store.tasks().some((t) => t.list_id === list.id) &&
      (!this.store.cloud() || list.owner_id === this.store.user()?.id)
    );
  }
  openTask(task?: Task, due?: string, time?: string) {
    this.pendingCycleId = null;
    if (this.store.loading()) return;
    if (!this.store.lists().length) {
      this.openList();
      this.store.notice.set("Сначала создайте список для задач.");
      return;
    }
    this.captureFocus();
    const list = this.listById(this.scope)?.id || this.store.lists()[0].id;
    this.editor = task
      ? structuredClone(task)
      : makeTask(
          list,
          this.store.user()?.id || "local",
          due === undefined ? this.today : due,
        );
    if (!task && this.area === "tasks" && this.view === "timeline")
      this.editor.is_milestone = true;
    if (time) this.editor.start_time = time;
    this.focusDialog();
  }
  openSettings(tab: "general" | "account" = "general") {
    this.captureFocus();
    this.modal = "settings";
    this.settingsTab = tab;
    this.focusDialog();
  }
  openList(list?: TaskList) {
    this.captureFocus();
    this.listEdit = list || null;
    this.listName = list?.name || "";
    this.listColor = list?.color || COLORS[0];
    this.modal = "list";
    this.focusDialog();
  }
  async saveList() {
    const result = this.listEdit
      ? await this.store.renameList(
          this.listEdit,
          this.listName,
          this.listColor,
        )
      : await this.store.createList(this.listName, this.listColor);
    if (result) this.closeOverlays();
  }
  async openShare(list: TaskList) {
    this.captureFocus();
    this.shareTarget = list;
    this.modal = "share";
    this.members = [];
    this.memberEmail = "";
    this.focusDialog();
    this.members = await this.store.members(list.id);
  }
  async share() {
    if (
      this.shareTarget &&
      (await this.store.shareList(this.shareTarget.id, this.memberEmail))
    ) {
      this.memberEmail = "";
      this.members = await this.store.members(this.shareTarget.id);
    }
  }
  async unshare(id: string) {
    if (
      this.shareTarget &&
      (await this.store.removeMember(this.shareTarget.id, id))
    )
      this.members = await this.store.members(this.shareTarget.id);
  }
  async authenticate() {
    await this.store.authenticate(
      this.authEmail,
      this.authPassword,
      this.register,
    );
    this.authPassword = "";
  }
  async importFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) {
      this.store.error.set("Файл слишком большой (максимум 10 МБ).");
      return;
    }
    this.importRaw = await file.text();
    this.confirm = "import";
    input.value = "";
  }
  confirmAction() {
    if (this.confirm === "clear") this.store.clearDemo();
    if (this.confirm === "import") this.store.importData(this.importRaw);
    this.confirm = null;
  }
  captureFocus() {
    this.returnFocus = document.activeElement as HTMLElement;
  }
  focusDialog() {
    setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(
            '[role="dialog"] input, [role="dialog"] button',
          )
          ?.focus(),
      10,
    );
  }
  closeOverlays() {
    this.editor = null;
    this.pendingCycleId = null;
    this.modal = null;
    this.confirm = null;
    this.returnFocus?.focus();
  }
  @HostListener("document:keydown", ["$event"]) keyboard(event: KeyboardEvent) {
    if (event.key === "Escape") {
      this.closeOverlays();
      this.mobileNav = false;
      return;
    }
    if (event.key === "Tab" && (this.editor || this.modal || this.confirm)) {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dialog = dialogs[dialogs.length - 1];
      const nodes = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]',
      );
      if (nodes?.length) {
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
      (event.target as HTMLElement)?.tagName,
    );
    if ((event.ctrlKey || event.metaKey) && event.key === "k") {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#global-search")?.focus();
    }
    if (
      !typing &&
      !this.modal &&
      !this.editor &&
      event.key.toLowerCase() === "n"
    ) {
      event.preventDefault();
      this.openTask();
    }
  }
}
