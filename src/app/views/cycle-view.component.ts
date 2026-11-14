import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TaskViewBase, TaskOpenRequest } from "../shared/task-view.base";
import { TaskCardComponent } from "../task-card.component";
import { TimelineViewComponent } from "./timeline-view.component";
import { DurationPickerComponent } from "../shared/duration-picker.component";
import { IconComponent } from "../icon.component";
import { addDays, PlanningCycle, Task } from "../models";
import {
  cycleEnd,
  dayDistance,
  cycleWeek,
  newCycle,
  planActions,
  weekScore,
} from "../planning";
@Component({
  selector: "app-cycle-view",
  standalone: true,
  imports: [
    FormsModule,
    TaskCardComponent,
    TimelineViewComponent,
    DurationPickerComponent,
    IconComponent,
  ],
  templateUrl: "./cycle-view.component.html",
  styleUrl: "./cycle-view.component.scss",
})
export class CycleViewComponent extends TaskViewBase {
  selectedId =
    this.store.cycles().find((c) => !c.archived)?.id ||
    this.store.cycles()[0]?.id ||
    "";
  selectedWeek = -1;
  onlyPending = false;
  tab: "week" | "timeline" | "review" = "week";
  draft: PlanningCycle | null = null;
  choosingGoals = false;
  chosenGoals: string[] = [];
  actionForm = false;
  actionTitle = "";
  actionGoal = "";
  actionDays = [0, 2, 4];
  firstWeek = 1;
  lastWeek = 12;
  actionDuration = 60;
  actionDurationValid = true;
  reviewWins = "";
  reviewImprove = "";
  days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  cycleEnd = cycleEnd;
  get cycle() {
    return (
      this.store.cycles().find((c) => c.id === this.selectedId) ||
      this.store.cycles().find((c) => !c.archived) ||
      this.store.cycles()[0]
    );
  }
  get week() {
    return this.selectedWeek < 0 && this.cycle
      ? cycleWeek(this.cycle)
      : this.selectedWeek;
  }
  get goals() {
    return this.store
      .tasks()
      .filter((t) => t.is_milestone && this.cycle?.goal_ids.includes(t.id));
  }
  get availableGoals() {
    return this.store.tasks().filter((t) => t.is_milestone);
  }
  get score() {
    return weekScore(this.store.tasks(), this.cycle!, this.week);
  }
  get weeks() {
    return Array.from({ length: 12 }, (_, i) => ({
      index: i,
      ...weekScore(this.store.tasks(), this.cycle!, i),
    }));
  }
  get elapsedPercent() {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (dayDistance(this.cycle!.start_date, this.today) / 84) * 100,
        ),
      ),
    );
  }
  get completedGoals() {
    return this.goals.filter((goal) => goal.status === "done").length;
  }
  get cycleScore() {
    const weeks = this.weeks;
    const total = weeks.reduce((sum, week) => sum + week.total, 0);
    const done = weeks.reduce((sum, week) => sum + week.done, 0);
    return { total, done };
  }
  get weekDays() {
    const tasks = this.score.tasks;
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(this.score.from, index);
      const all = tasks.filter((task) => task.due_date === date);
      return {
        date,
        done: all.filter((task) => task.status === "done").length,
        total: all.length,
        tasks: all.filter(
          (task) => !this.onlyPending || task.status !== "done",
        ),
      };
    }).filter((day) => day.tasks.length);
  }
  currentWeek() {
    this.selectWeek(cycleWeek(this.cycle!));
  }
  get statusLabel() {
    const c = this.cycle!;
    return c.archived
      ? "Цикл завершён"
      : this.today < c.start_date
        ? "Цикл ещё не начался"
        : this.today > cycleEnd(c)
          ? "12 недель позади · время подвести итоги"
          : `Сейчас неделя ${cycleWeek(c) + 1} из 12`;
  }
  get actionCount() {
    if (!this.cycle) return 0;
    const goal = this.goals.find((t) => t.id === this.actionGoal);
    if (!goal) return 0;
    try {
      return planActions(
        this.cycle,
        goal,
        this.actionTitle || "Действие",
        this.actionDays,
        this.firstWeek,
        this.lastWeek,
        this.actionDuration,
      ).length;
    } catch {
      return 0;
    }
  }
  get outsideGoals() {
    return this.goals.filter(
      (g) =>
        !g.due_date ||
        g.due_date < this.cycle!.start_date ||
        g.due_date > cycleEnd(this.cycle!),
    ).length;
  }
  selectCycle() {
    this.selectedWeek = -1;
    this.tab = "week";
    this.actionForm = false;
    this.choosingGoals = false;
    this.draft = null;
  }
  selectWeek(index: number) {
    this.selectedWeek = index;
    this.loadReview();
  }
  setTab(tab: "week" | "timeline" | "review") {
    this.tab = tab;
    if (tab === "review") this.loadReview();
  }
  createCycle() {
    this.draft = newCycle(this.store.user()?.id || "local");
  }
  editCycle() {
    this.draft = structuredClone(this.cycle!);
  }
  isExisting(id: string) {
    return this.store.cycles().some((c) => c.id === id);
  }
  async saveCycle() {
    if (this.draft && (await this.store.saveCycle(this.draft))) {
      this.selectedId = this.draft.id;
      this.selectedWeek = -1;
      this.draft = null;
    }
  }
  async archive() {
    if (
      await this.store.saveCycle({
        ...this.cycle!,
        archived: !this.cycle!.archived,
      })
    )
      this.store.notice.set(
        this.cycle!.archived
          ? "Цикл завершён. Цели, действия и итоги сохранены."
          : "Цикл снова активен.",
      );
  }
  openFromTimeline(request: TaskOpenRequest) {
    this.open.emit({ ...request, cycleId: this.cycle!.id });
  }
  newGoal() {
    this.open.emit({
      milestone: true,
      due: cycleEnd(this.cycle!),
      cycleId: this.cycle!.id,
    });
  }
  chooseGoals() {
    this.chosenGoals = [...this.cycle!.goal_ids];
    this.choosingGoals = !this.choosingGoals;
  }
  toggleGoal(id: string) {
    this.chosenGoals = this.chosenGoals.includes(id)
      ? this.chosenGoals.filter((x) => x !== id)
      : [...this.chosenGoals, id];
  }
  async saveGoals() {
    if (
      await this.store.saveCycle({ ...this.cycle!, goal_ids: this.chosenGoals })
    )
      this.choosingGoals = false;
  }
  showActions() {
    this.actionForm = !this.actionForm;
    this.actionGoal =
      this.goals.find((g) => g.status !== "done")?.id ||
      this.goals[0]?.id ||
      "";
    this.firstWeek = this.week + 1;
  }
  toggleDay(day: number) {
    this.actionDays = this.actionDays.includes(day)
      ? this.actionDays.filter((d) => d !== day)
      : [...this.actionDays, day];
  }
  async saveActions() {
    if (!this.actionDurationValid) return;
    const goal = this.goals.find((t) => t.id === this.actionGoal);
    if (!goal) return;
    try {
      const tasks = planActions(
        this.cycle!,
        goal,
        this.actionTitle,
        this.actionDays,
        this.firstWeek,
        this.lastWeek,
        this.actionDuration,
        this.store.user()?.id || "local",
      );
      if (await this.store.addPlannedActions(tasks)) {
        this.actionForm = false;
        this.actionTitle = "";
      }
    } catch (e) {
      this.store.error.set((e as Error).message);
    }
  }
  loadReview() {
    const review = this.cycle?.reviews[String(this.week)];
    this.reviewWins = review?.wins || "";
    this.reviewImprove = review?.improve || "";
  }
  async saveReview() {
    if (
      await this.store.saveCycle({
        ...this.cycle!,
        reviews: {
          ...this.cycle!.reviews,
          [String(this.week)]: {
            wins: this.reviewWins,
            improve: this.reviewImprove,
          },
        },
      })
    )
      this.store.notice.set("Итоги недели сохранены.");
  }
  goalTitle(task: Task) {
    return this.goals.find((g) => g.id === task.goal_id)?.title;
  }
  inFuture(from: string) {
    return from > this.today;
  }
  addDays = addDays;
}
