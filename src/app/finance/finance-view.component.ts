import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  ViewChild,
  inject,
} from "@angular/core";
import { AnimatedDetailsDirective } from "../shared/animated-details.directive";
import { DialogBackdropDirective } from "../shared/dialog-backdrop.directive";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon.component";
import { addDays, dateKey, parseDate } from "../models";
import { FinanceTagPickerComponent } from "./finance-tag-picker.component";
import { FinanceTag, rankedTags, storeTag, tagKey } from "./finance-tags";
import { reservedOnAccount, availableOnAccount } from "./savings";
import { SavingsViewComponent } from "./savings-view.component";
import { FinanceService } from "./finance.service";
import {
  Account,
  Category,
  FinanceData,
  Transaction,
  PaymentTemplate,
  Payment,
  accountBalance,
  id,
  moneyInput,
  parseMoney,
  removeTransaction,
  saveTemplate,
  saveTransaction,
  validateFinance,
} from "./finance";
@Component({
  selector: "app-finance-view",
  standalone: true,
  imports: [
    FormsModule,
    SavingsViewComponent,
    IconComponent,
    FinanceTagPickerComponent,
    DialogBackdropDirective,
    AnimatedDetailsDirective,
  ],
  templateUrl: "./finance-view.component.html",
  styleUrl: "./finance-view.component.scss",
})
export class FinanceViewComponent {
  readonly store = inject(FinanceService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild("entryDialog", { static: true })
  entryDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild("paymentDialog", { static: true })
  paymentDialog!: ElementRef<HTMLDialogElement>;
  @ViewChild("amountInput", { static: true })
  amountInput!: ElementRef<HTMLInputElement>;
  tab: "overview" | "transactions" | "plan" | "settings" | "savings" =
    "overview";
  notice = "";
  formError = "";
  templateError = "";
  search = "";
  filterCategory = "";
  filterKind = "";
  month = dateKey().slice(0, 7);
  entry = this.blankEntry();
  amount = "";
  category = "";
  tags = "";
  repeat = false;
  repeatDay = Number(dateKey().slice(8));
  template: PaymentTemplate = this.blankTemplate();
  templateAmount = "";
  templateCategory = "";
  linkId = "";
  rescheduleId = "";
  rescheduleDate = dateKey();
  accountName = "";
  accountCurrency = "USD";
  opening = "";
  categoryName = "";
  categoryEdit = "";
  categoryDelete = "";
  accountEdit = "";
  accountRename = "";
  undo: Transaction | null = null;
  importData: FinanceData | null = null;
  readonly reserved = reservedOnAccount;
  readonly available = availableOnAccount;
  currencies = ["USD", "EUR", "RSD"];
  get selectedTags() {
    return this.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  private entryTagSets: Record<string, string[]> = {};
  changeEntryKind(kind: string) {
    this.entryTagSets[this.entry.kind] = this.selectedTags;
    this.entry.kind = kind as Transaction["kind"];
    this.tags = (this.entryTagSets[kind] || []).join(", ");
    this.remember();
  }
  selectTags(names: string[]) {
    this.tags = names.join(", ");
    this.remember();
  }
  async saveFinanceTag(tag: FinanceTag, selectNew = false) {
    const newTag = !rankedTags(this.data, tag.kind).some(
      (existing) => tagKey(existing.name) === tagKey(tag.name),
    );
    if (await this.store.change((data) => storeTag(data, tag))) {
      if (selectNew && newTag && this.entry.kind === tag.kind)
        this.selectTags([...this.selectedTags, tag.name.trim()]);
    }
  }
  get today() {
    return dateKey();
  }
  get data() {
    return this.store.data();
  }
  get accounts() {
    return this.data.accounts;
  }
  get categories() {
    return this.data.categories;
  }
  get disabled() {
    return this.store.busy() || !this.store.ready();
  }
  get isEditing() {
    return this.data.transactions.some((t) => t.id === this.entry.id);
  }
  addReminder(payment: Payment) {
    return addDays(
      this.today,
      this.data.templates.find((t) => t.id === payment.templateId)
        ?.remindDays || 0,
    );
  }
  get selectedCurrency() {
    return this.account(this.entry.accountId)?.currency || "EUR";
  }
  get transactions() {
    return [...this.data.transactions]
      .reverse()
      .filter(
        (t) =>
          (!this.month || t.date.startsWith(this.month)) &&
          (!this.filterKind || t.kind === this.filterKind) &&
          (!this.filterCategory ||
            (this.filterCategory === "none"
              ? !t.categoryId
              : t.categoryId === this.filterCategory)) &&
          `${t.note} ${this.categoryLabel(t.categoryId)} ${t.tags.join(" ")} ${this.account(t.accountId)?.name}`
            .toLocaleLowerCase()
            .includes(this.search.toLocaleLowerCase()),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  get pending() {
    return this.data.payments
      .filter((p) => p.status === "pending")
      .sort((a, b) => a.due.localeCompare(b.due));
  }
  get shownPayments() {
    return this.pending.filter(
      (p) => p.due.startsWith(this.month) || p.due < this.month + "-01",
    );
  }
  get upcoming() {
    return this.pending.filter(
      (p) => p.due <= addDays(this.today, 14) || p.due <= this.addReminder(p),
    );
  }
  get recentCategories() {
    return [...this.categories]
      .sort((a, b) => {
        const recent = (id: string) =>
          this.data.transactions
            .filter((t) => t.categoryId === id)
            .map((t) => t.date)
            .sort()
            .at(-1) || "";
        return recent(b.id).localeCompare(recent(a.id));
      })
      .slice(0, 6);
  }
  get linkOptions() {
    return this.pending.filter((p) => p.accountId === this.entry.accountId);
  }
  get historyPayments() {
    return this.data.payments
      .filter((p) => p.status !== "pending" && p.due.startsWith(this.month))
      .sort((a, b) => a.due.localeCompare(b.due));
  }
  balance = accountBalance;
  moneyInput = moneyInput;
  account(accountId: string) {
    return this.accounts.find((a) => a.id === accountId);
  }
  categoryLabel(categoryId: string) {
    return (
      this.categories.find((c) => c.id === categoryId)?.name || "Без категории"
    );
  }
  format(amount: number, currency = "EUR") {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
    }).format(amount / 100);
  }
  date(date: string) {
    return parseDate(date).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  }
  monthly(kind: "expense" | "income", currency: string) {
    return this.data.transactions
      .filter(
        (t) =>
          t.kind === kind &&
          t.date.startsWith(this.month) &&
          this.account(t.accountId)?.currency === currency,
      )
      .reduce((s, t) => s + t.amount, 0);
  }
  get totals() {
    return [...new Set(this.accounts.map((a) => a.currency))].map(
      (currency) => ({
        currency,
        income: this.monthly("income", currency),
        expense: this.monthly("expense", currency),
      }),
    );
  }
  forecast(account: Account) {
    const payments = this.pending.filter(
      (p) => p.accountId === account.id && p.due <= addDays(this.today, 30),
    );
    return {
      known: payments.reduce((s, p) => s + (p.amount || 0), 0),
      unknown: payments.filter((p) => p.amount === null).length,
    };
  }
  blankEntry(): Transaction {
    return {
      id: id(),
      kind: "expense",
      amount: 0,
      accountId: "",
      toAccountId: "",
      date: dateKey(),
      categoryId: "",
      tags: [],
      note: "",
      occurrenceId: "",
    };
  }
  blankTemplate(): PaymentTemplate {
    return {
      id: id(),
      title: "",
      amount: null,
      accountId: "",
      categoryId: "",
      day: Number(dateKey().slice(8)),
      start: dateKey(),
      until: "",
      paused: false,
      remindDays: 3,
    };
  }
  private get draftKey() {
    return `flow.finance.draft.${this.store.planner.user()?.id || "local"}.${this.entry.kind}`;
  }
  remember() {
    if (this.isEditing || this.entry.occurrenceId) return;
    try {
      sessionStorage.setItem(
        this.draftKey,
        JSON.stringify({
          entry: this.entry,
          amount: this.amount,
          category: this.category,
          tags: this.tags,
          repeat: this.repeat,
          repeatDay: this.repeatDay,
        }),
      );
    } catch {
      /* The open form still retains its values. */
    }
  }
  openEntry(
    kind: Transaction["kind"] = "expense",
    existing?: Transaction,
    payment?: Payment,
    duplicate = false,
  ) {
    this.formError = "";
    this.entryTagSets = {};
    this.linkId = "";
    this.repeat = false;
    this.entry = existing ? structuredClone(existing) : this.blankEntry();
    this.entry.kind = existing?.kind || kind;
    this.entry.accountId =
      existing?.accountId ||
      payment?.accountId ||
      this.data.lastAccountId ||
      this.accounts[0]?.id ||
      "";
    this.amount = existing
      ? moneyInput(existing.amount)
      : payment
        ? moneyInput(payment.amount)
        : "";
    this.category =
      this.categories.find(
        (category) =>
          category.id === (existing?.categoryId || payment?.categoryId),
      )?.name || "";
    this.tags = existing?.tags.join(", ") || "";
    if (duplicate) {
      this.entry.id = id();
      this.entry.date = this.today;
      this.entry.occurrenceId = "";
    }
    if (payment) {
      this.entry.occurrenceId = payment.id;
      this.entry.note = payment.title;
    }
    if (!existing && !payment && kind === "expense") {
      try {
        const raw = sessionStorage.getItem(this.draftKey);
        if (raw) {
          const draft = JSON.parse(raw);
          if (
            draft.entry?.kind === kind &&
            !draft.entry?.occurrenceId &&
            !this.data.transactions.some((t) => t.id === draft.entry.id) &&
            this.accounts.some((a) => a.id === draft.entry.accountId)
          ) {
            this.entry = draft.entry;
            this.amount = draft.amount || "";
            this.category = draft.category || "";
            this.tags = draft.tags || "";
            this.repeat = !!draft.repeat;
            this.repeatDay = draft.repeatDay || this.repeatDay;
          }
        }
      } catch {
        /* Ignore invalid draft, never ledger data. */
      }
    }
    const details = this.entryDialog.nativeElement.querySelector("details");
    if (details) details.open = this.repeat || !!existing;
    this.entryDialog.nativeElement.showModal();
    this.amountInput.nativeElement.focus();
  }
  closeEntry() {
    this.remember();
    this.entryDialog.nativeElement.close();
  }
  resolveCategory(data: FinanceData, name: string) {
    const value = name.trim();
    if (!value) return "";
    const found = data.categories.find(
      (c) => c.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
    );
    if (found) return found.id;
    const category = { id: id(), name: value };
    data.categories.push(category);
    return category.id;
  }
  async saveEntry(another = false) {
    const amount = parseMoney(this.amount);
    if (!amount) {
      this.formError =
        "Введите сумму больше нуля, не более двух знаков после запятой.";
      return;
    }
    if (this.entry.date > this.today) {
      this.formError =
        "Будущие расходы добавляйте в план. Операция отражает уже совершённый платёж.";
      return;
    }
    if (
      this.repeat &&
      (this.entry.kind !== "expense" ||
        this.entry.occurrenceId ||
        !this.entry.note.trim())
    ) {
      this.formError =
        "Для регулярного платежа укажите название в комментарии.";
      return;
    }
    if (
      this.repeat &&
      (!Number.isInteger(this.repeatDay) ||
        this.repeatDay < 1 ||
        this.repeatDay > 31)
    ) {
      this.formError = "Укажите день месяца от 1 до 31.";
      return;
    }
    const transaction = {
      ...structuredClone(this.entry),
      amount,
      tags: [
        ...new Set(
          this.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ],
    };
    let saved: Transaction = transaction;
    const ok = await this.store.change((data) => {
      transaction.categoryId =
        transaction.kind === "transfer"
          ? ""
          : this.resolveCategory(data, this.category);
      let result = saveTransaction(data, transaction);
      if (this.repeat) {
        const template: PaymentTemplate = {
          ...this.blankTemplate(),
          title: transaction.note,
          amount,
          accountId: transaction.accountId,
          categoryId: transaction.categoryId,
          day: this.repeatDay,
          start: transaction.date,
        };
        result = saveTemplate(result, template);
        const first = result.payments.find(
          (p) =>
            p.templateId === template.id && p.originalDate === transaction.date,
        );
        if (first) {
          transaction.occurrenceId = first.id;
          result = saveTransaction(result, transaction);
        }
      }
      result.lastAccountId = transaction.accountId;
      saved = structuredClone(transaction);
      return result;
    });
    if (ok) {
      this.undo = saved;
      this.notice = "Операция записана";
      sessionStorage.removeItem(this.draftKey);
      this.entryDialog.nativeElement.close();
      if (another) {
        this.entry = this.blankEntry();
        this.entry.accountId = saved.accountId;
        this.entry.kind = saved.kind;
        this.amount = "";
        this.category = "";
        this.tags = "";
        this.repeat = false;
        this.entryDialog.nativeElement.showModal();
        this.amountInput.nativeElement.focus();
      }
    }
  }
  async undoLast() {
    if (
      this.undo &&
      (await this.store.change((data) =>
        removeTransaction(data, this.undo!.id),
      ))
    ) {
      this.undo = null;
      this.notice =
        "Запись отменена. Связанный платёж снова ожидает подтверждения.";
    }
  }
  async deleteEntry(transaction: Transaction) {
    if (
      await this.store.change((data) => removeTransaction(data, transaction.id))
    ) {
      this.undo = null;
      this.notice = "Операция удалена. Баланс пересчитан.";
      this.entryDialog.nativeElement.close();
    }
  }
  openTemplate(template?: PaymentTemplate) {
    this.templateError = "";
    this.template = template ? structuredClone(template) : this.blankTemplate();
    this.template.accountId ||= this.accounts[0]?.id || "";
    this.templateAmount = moneyInput(this.template.amount);
    this.templateCategory = template?.categoryId
      ? this.categoryLabel(template.categoryId)
      : "";
    this.paymentDialog.nativeElement.showModal();
  }
  async savePaymentTemplate() {
    const amount = this.templateAmount.trim()
      ? parseMoney(this.templateAmount)
      : null;
    if (this.templateAmount.trim() && amount === null) {
      this.templateError = "Проверьте сумму.";
      return;
    }
    if (!this.template.title.trim()) {
      this.templateError = "Укажите название платежа.";
      return;
    }
    const template = {
      ...structuredClone(this.template),
      amount,
      title: this.template.title.trim(),
    };
    if (
      await this.store.change((data) => {
        template.categoryId = this.resolveCategory(data, this.templateCategory);
        return saveTemplate(data, template);
      })
    ) {
      this.paymentDialog.nativeElement.close();
      this.notice = "Расписание сохранено. Прошлые оплаты сохранены.";
    }
  }
  async toggleTemplate(template: PaymentTemplate) {
    await this.store.change((data) =>
      saveTemplate(data, { ...template, paused: !template.paused }),
    );
  }
  async skip(payment: Payment) {
    if (
      await this.store.change((data) => {
        const p = data.payments.find((p) => p.id === payment.id);
        if (!p || p.status !== "pending")
          throw new Error("Платёж уже изменён. Обновите данные.");
        p.status = "skipped";
        return data;
      })
    )
      this.notice = "Этот платёж пропущен. Следующие месяцы остаются в плане.";
  }
  async restorePayment(payment: Payment) {
    await this.store.change((data) => {
      const p = data.payments.find((p) => p.id === payment.id);
      if (p?.status === "skipped") p.status = "pending";
      return data;
    });
  }
  async reschedule(payment: Payment) {
    if (
      await this.store.change((data) => {
        const p = data.payments.find((p) => p.id === payment.id);
        if (!p || p.status !== "pending")
          throw new Error("Платёж уже изменён.");
        p.due = this.rescheduleDate;
        return data;
      })
    ) {
      this.rescheduleId = "";
      this.notice = "Дата изменена только для этой оплаты.";
    }
  }
  async link(payment: Payment) {
    const transaction = this.data.transactions.find(
      (t) => t.id === this.linkId,
    );
    if (!transaction) return;
    if (
      await this.store.change((data) =>
        saveTransaction(data, { ...transaction, occurrenceId: payment.id }),
      )
    ) {
      this.linkId = "";
      this.notice = "Операция связана с платежом. Второй расход не создан.";
    }
  }
  candidates(payment: Payment) {
    return this.data.transactions
      .filter(
        (t) =>
          t.kind === "expense" &&
          t.accountId === payment.accountId &&
          !t.occurrenceId,
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  async addAccount() {
    const raw = this.opening.trim(),
      negative = raw.startsWith("-");
    const opening =
      !raw || /^-?0([.,]0{1,2})?$/.test(raw)
        ? 0
        : parseMoney(negative ? raw.slice(1) : raw);
    if (!this.accountName.trim() || opening === null) {
      this.store.error.set(
        "Укажите название счёта и корректный начальный остаток; для нуля оставьте поле пустым.",
      );
      return;
    }
    if (
      await this.store.change((data) => {
        data.accounts.push({
          id: id(),
          name: this.accountName.trim(),
          currency: this.accountCurrency,
          opening: (negative ? -1 : 1) * opening,
        });
        return data;
      })
    ) {
      this.accountName = "";
      this.accountCurrency = "USD";
      this.opening = "";
      this.notice = "Счёт добавлен";
    }
  }
  async renameAccount() {
    if (
      await this.store.change((data) => {
        const account = data.accounts.find((a) => a.id === this.accountEdit);
        if (account) account.name = this.accountRename.trim();
        return data;
      })
    )
      this.accountEdit = "";
  }
  async saveCategory() {
    if (
      await this.store.change((data) => {
        if (this.categoryEdit) {
          const category = data.categories.find(
            (c) => c.id === this.categoryEdit,
          );
          if (category) category.name = this.categoryName.trim();
        } else this.resolveCategory(data, this.categoryName);
        return data;
      })
    ) {
      this.categoryName = "";
      this.categoryEdit = "";
    }
  }
  async removeCategory(category: Category) {
    if (
      await this.store.change((data) => {
        data.categories = data.categories.filter((c) => c.id !== category.id);
        for (const collection of [
          data.transactions,
          data.templates,
          data.payments,
        ])
          for (const item of collection)
            if (item.categoryId === category.id) item.categoryId = "";
        return data;
      })
    )
      this.categoryDelete = "";
  }
  exportBackup() {
    const blob = new Blob([JSON.stringify(this.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flow-finance-${this.today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async readBackup(event: Event) {
    try {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 10_000_000) throw new Error("Файл слишком большой.");
      this.importData = validateFinance(JSON.parse(await file.text()));
    } catch (e) {
      this.store.error.set((e as Error).message);
    } finally {
      (event.target as HTMLInputElement).value = "";
      this.changeDetector.markForCheck();
    }
  }
  async restoreBackup() {
    if (
      this.importData &&
      (await this.store.change(() => structuredClone(this.importData!)))
    ) {
      this.importData = null;
      this.notice = "Финансовая копия восстановлена";
    }
  }
}
