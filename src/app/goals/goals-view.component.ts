import { Component, ElementRef, ViewChild, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { GoalsService } from "./goals.service";
import { LongGoal, focusedGoals, rankedGoals, validateGoals } from "./goals";
import { ExpenseImportanceComponent } from "../finance/expense-importance.component";
import { DialogBackdropDirective } from "../shared/dialog-backdrop.directive";
@Component({
  selector: "app-goals-view",
  standalone: true,
  imports: [FormsModule, ExpenseImportanceComponent, DialogBackdropDirective],
  templateUrl: "./goals-view.component.html",
  styleUrl: "./goals-view.component.scss",
})
export class GoalsViewComponent {
  readonly store = inject(GoalsService);
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  draft = this.blank();
  error = "";
  filter = "all";
  search = "";
  readonly labels = [
    "Без приоритета",
    "Низкий приоритет",
    "Небольшой приоритет",
    "Средний приоритет",
    "Высокий приоритет",
    "Главный приоритет",
  ];
  readonly statuses: Record<string, string> = {
    active: "Активна",
    future: "На будущее",
    paused: "На паузе",
    done: "Достигнута",
  };
  get podium() {
    return focusedGoals(this.store.data().goals);
  }
  get remaining() {
    const ids = this.podium.map((g) => g.id);
    return rankedGoals(this.store.data().goals).filter(
      (g) =>
        !ids.includes(g.id) &&
        (this.filter === "all" || g.status === this.filter) &&
        g.title.toLocaleLowerCase().includes(this.search.toLocaleLowerCase()),
    );
  }
  blank(): LongGoal {
    return {
      id: crypto.randomUUID(),
      title: "",
      why: "",
      next: "",
      priority: 3,
      status: "active",
      progress: 0,
      deadline: "",
      created: new Date().toISOString(),
    };
  }
  open(goal?: LongGoal) {
    this.draft = goal ? structuredClone(goal) : this.blank();
    this.error = "";
    this.store.error.set("");
    this.dialog.nativeElement.showModal();
  }
  async save() {
    const goal = {
      ...this.draft,
      title: this.draft.title.trim(),
      progress:
        this.draft.status === "done" ? 100 : Number(this.draft.progress),
    };
    try {
      if (
        await this.store.change((data) =>
          validateGoals({
            ...data,
            goals: [...data.goals.filter((g) => g.id !== goal.id), goal],
          }),
        )
      )
        this.dialog.nativeElement.close();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }
  export() {
    const blob = new Blob([JSON.stringify(this.store.data(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flow-long-goals.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  async import(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("Файл слишком большой.");
      const incoming = validateGoals(JSON.parse(await file.text()));
      await this.store.change((data) => ({
        ...data,
        goals: [
          ...data.goals.filter(
            (g) => !incoming.goals.some((n) => n.id === g.id),
          ),
          ...incoming.goals,
        ],
      }));
    } catch (e) {
      this.store.error.set((e as Error).message);
    }
    input.value = "";
  }
}
