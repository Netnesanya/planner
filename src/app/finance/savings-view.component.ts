import { Component, ElementRef, ViewChild, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FinanceService } from "./finance.service";
import {
  SavingsGoal,
  savedAmount,
  allocateSavings,
  availableOnAccount,
  reservedOnAccount,
} from "./savings";
import { parseMoney, moneyInput, id } from "./finance";
import { DialogBackdropDirective } from "../shared/dialog-backdrop.directive";
@Component({
  selector: "app-savings-view",
  standalone: true,
  imports: [FormsModule, DialogBackdropDirective],
  templateUrl: "./savings-view.component.html",
  styleUrl: "./savings-view.component.scss",
})
export class SavingsViewComponent {
  readonly store = inject(FinanceService);
  @ViewChild("editor", { static: true }) editor!: ElementRef<HTMLDialogElement>;
  @ViewChild("allocation", { static: true })
  allocation!: ElementRef<HTMLDialogElement>;
  title = "";
  currency = "USD";
  target = "";
  editId = "";
  error = "";
  selectedId = "";
  accountId = "";
  amount = "";
  direction = "add";
  showArchived = false;
  readonly saved = savedAmount;
  readonly abs = Math.abs;
  get selectedReserve() {
    return (
      this.selected?.allocations.find((a) => a.accountId === this.accountId)
        ?.amount || 0
    );
  }
  readonly available = availableOnAccount;
  readonly reserved = reservedOnAccount;
  get goals() {
    return (this.store.data().savings || []).filter(
      (g) => g.archived === this.showArchived,
    );
  }
  get selected() {
    return this.store.data().savings?.find((g) => g.id === this.selectedId);
  }
  get accounts() {
    return this.store
      .data()
      .accounts.filter((a) => a.currency === this.selected?.currency);
  }
  format(amount: number, currency: string) {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  }
  percent(g: SavingsGoal) {
    return Math.min(100, Math.round((savedAmount(g) / g.target) * 100));
  }
  open(goal?: SavingsGoal) {
    this.editId = goal?.id || "";
    this.title = goal?.title || "";
    this.currency = goal?.currency || "USD";
    this.target = goal ? moneyInput(goal.target) : "";
    this.error = "";
    this.store.error.set("");
    this.editor.nativeElement.showModal();
  }
  async save() {
    const target = parseMoney(this.target);
    if (!target || !this.title.trim()) {
      this.error = "Укажите название и сумму больше нуля.";
      return;
    }
    if (
      await this.store.change((data) => {
        const old = data.savings?.find((g) => g.id === this.editId);
        const goal: SavingsGoal = {
          id: old?.id || id(),
          title: this.title.trim(),
          currency: old?.currency || this.currency,
          target,
          allocations: old?.allocations || [],
          archived: old?.archived || false,
        };
        return {
          ...data,
          savings: [
            ...(data.savings || []).filter((g) => g.id !== goal.id),
            goal,
          ],
        };
      })
    )
      this.editor.nativeElement.close();
  }
  reserve(goal: SavingsGoal) {
    this.selectedId = goal.id;
    this.accountId =
      this.store.data().accounts.find((a) => a.currency === goal.currency)
        ?.id || "";
    this.amount = "";
    this.direction = "add";
    this.error = "";
    this.store.error.set("");
    this.allocation.nativeElement.showModal();
  }
  async apply() {
    const amount = parseMoney(this.amount);
    if (!amount) {
      this.error = "Введите сумму больше нуля.";
      return;
    }
    if (
      await this.store.change((data) =>
        allocateSavings(
          data,
          this.selectedId,
          this.accountId,
          this.direction === "add" ? amount : -amount,
        ),
      )
    )
      this.allocation.nativeElement.close();
  }
  async archive(goal: SavingsGoal) {
    await this.store.change((data) => {
      const current = data.savings?.find((g) => g.id === goal.id);
      if (!current || savedAmount(current))
        throw new Error("Сначала освободите зарезервированные деньги.");
      return {
        ...data,
        savings: data.savings!.map((g) =>
          g.id === goal.id ? { ...g, archived: !g.archived } : g,
        ),
      };
    });
  }
}
