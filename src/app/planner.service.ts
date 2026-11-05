import { Injectable, signal, computed } from "@angular/core";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import {
  COLORS,
  dateKey,
  LOCAL_USER,
  makeTask,
  PlannerData,
  PlanningCycle,
  Preferences,
  Status,
  Task,
  TaskList,
  transitionTask,
  validateData,
  validProgress,
  TaskPatch,
} from "./models";
import {
  expandRecurrences,
  saveRecurringTask,
  deleteRecurringTask,
  recurrenceDelta,
  normalizeTask,
} from "./recurrence";
import { validCycle } from "./planning";
import { createDemo } from "./demo";

declare global {
  interface Window {
    FLOW_CONFIG?: { supabaseUrl: string; supabaseKey: string };
  }
}
const DATA_KEY = "flow.planner.v1";
const CONFIG_KEY = "flow.connection.v1";

@Injectable({ providedIn: "root" })
export class PlannerService {
  readonly tasks = signal<Task[]>([]);
  readonly cycles = signal<PlanningCycle[]>([]);
  readonly lists = signal<TaskList[]>([]);
  readonly user = signal<User | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly configured = signal(false);
  readonly online = signal(navigator.onLine);
  readonly preferences = signal<Preferences>({
    view: "list",
    showCompleted: true,
    sort: "time",
  });
  readonly cloud = computed(() => !!this.user());
  private client: SupabaseClient | null = null;
  get financialClient() {
    return this.cloud() ? this.client : null;
  }
  private stopAuth?: () => void;
  private revision = 0;
  private loadId = 0;
  private refreshing = false;
  config = { supabaseUrl: "", supabaseKey: "" };

  constructor() {
    this.loadLocal();
    try {
      const pref = JSON.parse(
        localStorage.getItem("flow.preferences") || "null",
      );
      if (pref) this.preferences.set({ ...this.preferences(), ...pref });
    } catch {
      /* defaults */
    }
    try {
      this.config =
        JSON.parse(localStorage.getItem(CONFIG_KEY) || "null") ||
        window.FLOW_CONFIG ||
        this.config;
    } catch {
      /* defaults */
    }
    if (this.config.supabaseUrl && this.config.supabaseKey) void this.connect();
    window.addEventListener("online", () => {
      this.online.set(true);
      void this.refresh();
    });
    window.addEventListener("offline", () => this.online.set(false));
    window.addEventListener("focus", () => {
      if (!this.busy()) void this.refresh();
    });
    window.addEventListener("storage", (e) => {
      if (e.key === DATA_KEY && !this.cloud()) this.loadLocal();
    });
  }
  private loadLocal() {
    try {
      const raw = localStorage.getItem(DATA_KEY);
      const data = raw ? validateData(JSON.parse(raw)) : createDemo();
      if (
        data.cycles &&
        (!Array.isArray(data.cycles) || !data.cycles.every(validCycle))
      )
        throw new Error("Некорректные циклы.");
      this.cycles.set(data.cycles || []);
      const expanded = expandRecurrences(data.tasks, dateKey(), LOCAL_USER);
      this.tasks.set(expanded);
      this.lists.set(data.lists);
      if (!raw || recurrenceDelta(data.tasks, expanded).saved.length)
        localStorage.setItem(
          DATA_KEY,
          JSON.stringify({ ...data, tasks: expanded }),
        );
    } catch {
      this.error.set(
        "Не удалось прочитать локальные данные. Сделайте резервную копию хранилища перед импортом.",
      );
    }
  }
  private persist(
    tasks = this.tasks(),
    lists = this.lists(),
    cycles = this.cycles(),
  ) {
    localStorage.setItem(
      DATA_KEY,
      JSON.stringify({ version: 1, tasks, lists, cycles }),
    );
    this.tasks.set(tasks);
    this.lists.set(lists);
    this.cycles.set(cycles);
  }
  private async run(action: () => Promise<void>) {
    if (this.busy() || this.loading()) return false;
    this.busy.set(true);
    this.error.set("");
    this.revision++;
    try {
      await action();
      return true;
    } catch (e) {
      this.error.set(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : String(e),
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }
  async saveConfig(url: string, key: string) {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        !key.trim() ||
        key.startsWith("sb_secret_")
      )
        throw new Error(
          "Нужны HTTPS Project URL и публичный publishable / anon key.",
        );
      if (key.split(".").length === 3) {
        try {
          if (
            JSON.parse(
              atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
            ).role === "service_role"
          )
            throw new Error("service_role нельзя использовать в браузере.");
        } catch (e) {
          if (e instanceof Error && e.message.includes("service_role")) throw e;
        }
      }
      if (this.user()) throw new Error("Сначала выйдите из аккаунта.");
      this.config = {
        supabaseUrl: url.replace(/\/$/, ""),
        supabaseKey: key.trim(),
      };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
      await this.connect();
      this.notice.set("Подключение сохранено. Теперь войдите в аккаунт.");
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  private async connect() {
    this.loading.set(true);
    try {
      this.stopAuth?.();
      await this.client?.removeAllChannels();
      this.client = createClient(
        this.config.supabaseUrl,
        this.config.supabaseKey,
      );
      this.configured.set(true);
      const listener = this.client.auth.onAuthStateChange((_event, session) => {
        const previous = this.user()?.id;
        this.user.set(session?.user || null);
        if (previous !== session?.user?.id) {
          this.revision++;
          this.loadId++;
          if (session?.user) {
            this.tasks.set([]);
            this.lists.set([]);
            this.cycles.set([]);
            this.loading.set(true);
            setTimeout(() => void this.openAccount(), 0);
          } else {
            this.loading.set(false);
            this.loadLocal();
          }
        }
      });
      this.stopAuth = () => listener.data.subscription.unsubscribe();
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      if (!data.session) this.loading.set(false);
    } catch (e) {
      this.error.set((e as Error).message);
      this.loading.set(false);
    }
  }
  private async openAccount() {
    const userId = this.user()?.id;
    if (!userId) return;
    try {
      await this.refresh(true);
      if (this.user()?.id !== userId) return;
      const { data } = await this.client!.from("preferences")
        .select("settings")
        .eq("user_id", userId)
        .maybeSingle();
      if (this.user()?.id !== userId) return;
      if (data?.settings)
        this.preferences.set({ ...this.preferences(), ...data.settings });
      await this.client!.removeAllChannels();
      this.client!.channel("planner-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          () => void this.refresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lists" },
          () => void this.refresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "planning_cycles" },
          () => void this.refresh(),
        )
        .subscribe();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      if (this.user()?.id === userId) this.loading.set(false);
    }
  }
  private async fetchTasks() {
    const rows: Task[] = [];
    for (let offset = 0; offset < 50000; offset += 1000) {
      const { data, error } = await this.client!.from("tasks")
        .select("*")
        .order("created_at")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return { data: rows, error: null };
  }
  async refresh(initial = false) {
    if (!this.user()) {
      if (!this.busy() && !this.loading()) {
        const expanded = expandRecurrences(this.tasks(), dateKey(), LOCAL_USER);
        if (recurrenceDelta(this.tasks(), expanded).saved.length)
          this.persist(expanded);
      }
      return;
    }
    if (!this.client || this.refreshing || (!initial && this.busy())) return;
    this.refreshing = true;
    const userId = this.user()!.id,
      revision = this.revision,
      loadId = ++this.loadId;
    try {
      const [lists, tasks, cycles] = await Promise.all([
        this.client.from("lists").select("*").order("created_at"),
        this.fetchTasks(),
        this.client.from("planning_cycles").select("*").order("start_date"),
      ]);
      if (lists.error) throw lists.error;
      if (tasks.error) throw tasks.error;
      if (cycles.error) throw cycles.error;
      if (
        userId !== this.user()?.id ||
        revision !== this.revision ||
        loadId !== this.loadId
      )
        return;
      this.cycles.set(cycles.data || []);
      this.lists.set(
        (lists.data || []).map((l) => ({
          ...l,
          shared: l.owner_id !== userId || l.is_shared,
        })),
      );
      const loaded = (tasks.data || []).map((t) => ({
        ...t,
        start_time: t.start_time?.slice(0, 5) || null,
      }));
      this.tasks.set(loaded);
      const expanded = expandRecurrences(loaded, dateKey(), userId);
      if (recurrenceDelta(loaded, expanded).saved.length)
        await this.commitTasks(expanded);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.refreshing = false;
    }
  }
  async authenticate(email: string, password: string, register: boolean) {
    return this.run(async () => {
      if (!this.client) throw new Error("Сначала подключите Supabase.");
      const { data, error } = register
        ? await this.client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: location.origin + location.pathname },
          })
        : await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (register && !data.session)
        this.notice.set(
          "Проверьте почту и подтвердите регистрацию, затем войдите.",
        );
    });
  }
  async signOut() {
    return this.run(async () => {
      const { error } = await this.client!.auth.signOut();
      if (error) throw error;
      await this.client!.removeAllChannels();
      this.user.set(null);
      this.loadLocal();
    });
  }
  async saveTask(task: Task) {
    return this.run(async () => {
      if (task.is_milestone && (task.goal_id || task.recurrence !== "none"))
        throw new Error("Цель не может повторяться или входить в другую цель.");
      if (
        task.goal_id &&
        this.tasks().find((t) => t.id === task.id)?.goal_id !== task.goal_id &&
        !this.tasks().some((g) => g.id === task.goal_id && g.is_milestone)
      )
        throw new Error("Связанный майлстоун недоступен.");
      if (this.tasks().some((t) => t.goal_id === task.id && !task.is_milestone))
        throw new Error(
          "Сначала отвяжите задачи, чтобы изменить тип майлстоуна.",
        );
      if (!validProgress(task))
        throw new Error("Проверьте прогресс: сделано ≥ 0, цель > 0.");
      if (!task.title.trim()) throw new Error("Добавьте название задачи.");
      if (
        !Number.isInteger(task.duration) ||
        task.duration < 5 ||
        task.duration > 1440
      )
        throw new Error("Длительность: от 5 до 1440 минут.");
      if (task.recurrence !== "none" && !task.due_date)
        throw new Error("Для повторения укажите дату.");
      if (task.start_time && !task.due_date)
        throw new Error("Для времени начала укажите дату.");
      task = {
        ...task,
        title: task.title.trim(),
        start_time: task.is_milestone ? null : task.start_time,
        repeat_anchor:
          task.repeat_anchor ||
          (task.due_date ? Number(task.due_date.slice(8)) : null),
      };
      const next = saveRecurringTask(
        this.tasks(),
        task,
        dateKey(),
        this.user()?.id || LOCAL_USER,
      );
      await this.commitTasks(next);
    });
  }
  async patchTask(id: string, patch: TaskPatch["patch"]) {
    const current = this.tasks().find((task) => task.id === id);
    if (current) return this.saveTask({ ...current, ...patch });
    return false;
  }
  async setStatus(task: Task, status: Status) {
    const success = await this.run(async () => {
      if (this.cloud()) {
        const { error } = await this.client!.rpc("set_task_status", {
          task_id: task.id,
          new_status: status,
        });
        if (error) throw error;
      } else this.persist(transitionTask(this.tasks(), task.id, status));
    });
    if (success && this.cloud()) await this.refresh();
    return success;
  }
  async reorderTasks(ids: string[]) {
    const ranks = new Map(ids.map((id, index) => [id, index * 1024]));
    const success = await this.run(async () => {
      if (this.cloud()) {
        const { error } = await this.client!.rpc("reorder_tasks", {
          task_ids: ids,
        });
        if (error) throw error;
        this.tasks.update((tasks) =>
          tasks.map((t) =>
            ranks.has(t.id) ? { ...t, sort_order: ranks.get(t.id)! } : t,
          ),
        );
      } else
        this.persist(
          this.tasks().map((t) =>
            ranks.has(t.id) ? { ...t, sort_order: ranks.get(t.id)! } : t,
          ),
        );
    });
    if (success) await this.savePreferences({ sort: "manual" });
    return success;
  }
  private async commitTasks(next: Task[]) {
    if (!this.cloud()) {
      this.persist(next);
      return;
    }
    const delta = recurrenceDelta(this.tasks(), next);
    if (!delta.saved.length && !delta.deleted.length) return;
    const userId = this.user()?.id,
      revision = this.revision;
    const { data, error } = await this.client!.rpc("apply_task_changes", {
      task_rows: delta.saved.map(normalizeTask),
      delete_ids: delta.deleted,
    });
    if (error) throw error;
    if (this.user()?.id !== userId || this.revision !== revision) return;
    this.tasks.set(
      (data || []).map((t: Task) => ({
        ...t,
        start_time: t.start_time?.slice(0, 5) || null,
      })),
    );
  }
  async deleteTask(task: Task) {
    return this.run(async () => {
      await this.commitTasks(deleteRecurringTask(this.tasks(), task));
    });
  }
  async createList(name: string, color: string) {
    let created: TaskList | null = null;
    const success = await this.run(async () => {
      if (!name.trim()) throw new Error("Введите название списка.");
      const list: TaskList = {
        id: crypto.randomUUID(),
        name: name.trim(),
        color,
        owner_id: this.user()?.id || LOCAL_USER,
      };
      if (this.cloud()) {
        const { error } = await this.client!.from("lists").insert(list);
        if (error) throw error;
        this.lists.update((l) => [...l, list]);
      } else this.persist(this.tasks(), [...this.lists(), list]);
      created = list;
    });
    return success ? created : null;
  }
  async renameList(list: TaskList, name: string, color: string) {
    return this.run(async () => {
      if (!name.trim()) throw new Error("Введите название списка.");
      if (this.cloud()) {
        const { error } = await this.client!.from("lists")
          .update({ name: name.trim(), color })
          .eq("id", list.id)
          .select("id")
          .single();
        if (error) throw error;
        this.lists.update((l) =>
          l.map((x) =>
            x.id === list.id ? { ...x, name: name.trim(), color } : x,
          ),
        );
      } else
        this.persist(
          this.tasks(),
          this.lists().map((x) =>
            x.id === list.id ? { ...x, name: name.trim(), color } : x,
          ),
        );
    });
  }
  async shareList(listId: string, email: string) {
    const success = await this.run(async () => {
      if (!this.cloud())
        throw new Error("Общие списки станут доступны после входа в Supabase.");
      const { error } = await this.client!.rpc("share_list", {
        target_list: listId,
        member_email: email.trim(),
      });
      if (error) throw error;
      this.notice.set(
        "Доступ к списку предоставлен. Второму участнику нужно обновить данные.",
      );
    });
    if (success) await this.refresh();
    return success;
  }
  async members(listId: string): Promise<{ user_id: string; email: string }[]> {
    if (!this.cloud()) return [];
    const { data, error } = await this.client!.rpc("list_members_info", {
      target_list: listId,
    });
    if (error) {
      this.error.set(error.message);
      return [];
    }
    return data || [];
  }
  async removeMember(listId: string, userId: string) {
    return this.run(async () => {
      const { error } = await this.client!.rpc("unshare_list", {
        target_list: listId,
        member_id: userId,
      });
      if (error) throw error;
    });
  }
  async saveCycle(cycle: PlanningCycle) {
    return this.run(async () => {
      if (!validCycle(cycle))
        throw new Error("Проверьте название, дату и записи цикла.");
      const next = { ...cycle, name: cycle.name.trim() };
      if (this.cloud()) {
        const exists = this.cycles().some((c) => c.id === next.id);
        const query = exists
          ? this.client!.from("planning_cycles").update(next).eq("id", next.id)
          : this.client!.from("planning_cycles").insert(next);
        const { error } = await query.select("id").single();
        if (error) throw error;
      }
      const cycles = this.cycles().some((c) => c.id === next.id)
        ? this.cycles().map((c) => (c.id === next.id ? next : c))
        : [...this.cycles(), next];
      if (this.cloud()) this.cycles.set(cycles);
      else this.persist(this.tasks(), this.lists(), cycles);
    });
  }
  async addPlannedActions(tasks: Task[]) {
    return this.run(async () => {
      if (!tasks.length || tasks.length > 84)
        throw new Error("Выберите дни и недели для действий.");
      validateData({
        version: 1,
        lists: this.lists(),
        tasks: [...this.tasks(), ...tasks],
      });
      if (this.cloud()) {
        const { data, error } = await this.client!.from("tasks")
          .insert(tasks)
          .select();
        if (error) throw error;
        this.tasks.update((current) => [
          ...current,
          ...data.map((t) => ({
            ...t,
            start_time: t.start_time?.slice(0, 5) || null,
          })),
        ]);
      } else this.persist([...this.tasks(), ...tasks]);
      this.notice.set(
        `Добавлено действий: ${tasks.length}. Они доступны в списках и календаре.`,
      );
    });
  }
  async deleteEmptyList(list: TaskList) {
    return this.run(async () => {
      if (
        this.lists().length <= 1 ||
        this.tasks().some((t) => t.list_id === list.id)
      )
        throw new Error(
          "Можно удалить только пустой список. Хотя бы один список должен остаться.",
        );
      if (this.cloud()) {
        const { error } = await this.client!.from("lists")
          .delete()
          .eq("id", list.id)
          .select("id")
          .single();
        if (error) throw error;
      }
      const lists = this.lists().filter((l) => l.id !== list.id);
      if (this.cloud()) this.lists.set(lists);
      else this.persist(this.tasks(), lists);
    });
  }
  async savePreferences(patch: Partial<Preferences>) {
    const prefs = { ...this.preferences(), ...patch };
    this.preferences.set(prefs);
    try {
      localStorage.setItem("flow.preferences", JSON.stringify(prefs));
      if (this.cloud()) {
        const { error } = await this.client!.from("preferences").upsert({
          user_id: this.user()!.id,
          settings: prefs,
        });
        if (error) throw error;
      }
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
  exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            lists: this.lists(),
            tasks: this.tasks(),
            cycles: this.cycles(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `flow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  importData(raw: string) {
    try {
      if (this.cloud()) throw new Error("Импорт доступен в локальном режиме.");
      const data = validateData(JSON.parse(raw));
      if (
        data.cycles &&
        (!Array.isArray(data.cycles) || !data.cycles.every(validCycle))
      )
        throw new Error("Некорректные циклы.");
      this.persist(
        data.tasks.map((t) => ({ ...t, created_by: LOCAL_USER })),
        data.lists.map((l) => ({ ...l, owner_id: LOCAL_USER, shared: false })),
        (data.cycles || []).map((c) => ({ ...c, owner_id: LOCAL_USER })),
      );
      this.notice.set("Резервная копия восстановлена.");
      return true;
    } catch (e) {
      this.error.set((e as Error).message);
      return false;
    }
  }
  clearDemo() {
    if (this.cloud()) return;
    const list = {
      id: crypto.randomUUID(),
      name: "Входящие",
      color: COLORS[0],
      owner_id: LOCAL_USER,
    };
    try {
      this.persist([], [list], []);
      this.notice.set("Чистый лист. Можно начинать!");
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
