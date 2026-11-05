import { dateKey, parseDate } from "../models";
import { canonicalTags, tagKey, type FinanceTag } from "./finance-tags";
import { validateSavings, type SavingsGoal } from "./savings";
export interface Account {
  id: string;
  name: string;
  currency: string;
  opening: number;
}
export interface Category {
  id: string;
  name: string;
}
export interface Transaction {
  id: string;
  kind: "expense" | "income" | "transfer";
  amount: number;
  accountId: string;
  toAccountId: string;
  date: string;
  categoryId: string;
  tags: string[];
  note: string;
  occurrenceId: string;
}
export interface PaymentTemplate {
  id: string;
  title: string;
  amount: number | null;
  accountId: string;
  categoryId: string;
  day: number;
  start: string;
  until: string;
  paused: boolean;
  remindDays: number;
}
export interface Payment {
  id: string;
  templateId: string;
  originalDate: string;
  due: string;
  title: string;
  amount: number | null;
  accountId: string;
  categoryId: string;
  status: "pending" | "paid" | "skipped";
}
export interface FinanceData {
  version: 1;
  accounts: Account[];
  lastAccountId?: string;
  categories: Category[];
  tags?: FinanceTag[];
  savings?: SavingsGoal[];
  transactions: Transaction[];
  templates: PaymentTemplate[];
  payments: Payment[];
}
export const emptyFinance = (): FinanceData => ({
  version: 1,
  accounts: [],
  categories: [],
  transactions: [],
  templates: [],
  payments: [],
});
export const id = () => crypto.randomUUID();
export const validDate = (value: string) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  dateKey(parseDate(value)) === value;
export function parseMoney(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
export const moneyInput = (amount: number | null) =>
  amount === null ? "" : (amount / 100).toFixed(2);
export function monthlyDate(month: string, day: number) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(year, m, 0).getDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
/** Materialize a rolling year. Original dates are stable identities, never derived from a moved payment. */
export function expandPayments(
  data: FinanceData,
  today = dateKey(),
): FinanceData {
  const result = structuredClone(data);
  const paymentPeriods = new Set(
    result.payments.map(
      (payment) => `${payment.templateId}:${payment.originalDate.slice(0, 7)}`,
    ),
  );
  for (const template of result.templates) {
    if (template.paused) continue;
    const start = parseDate(template.start);
    const end = parseDate(today);
    end.setDate(1);
    end.setMonth(end.getMonth() + 12);
    for (
      let year = start.getFullYear(), month = start.getMonth();
      year * 12 + month <= end.getFullYear() * 12 + end.getMonth();
      month++
    ) {
      if (month > 11) {
        year++;
        month = 0;
      }
      const date = monthlyDate(
        `${year}-${String(month + 1).padStart(2, "0")}`,
        template.day,
      );
      if (date < template.start || (template.until && date > template.until))
        continue;
      const paymentId = `${template.id}:${date}`;
      const period = `${template.id}:${date.slice(0, 7)}`;
      if (!paymentPeriods.has(period))
        result.payments.push({
          id: paymentId,
          templateId: template.id,
          originalDate: date,
          due: date,
          title: template.title,
          amount: template.amount,
          accountId: template.accountId,
          categoryId: template.categoryId,
          status: "pending",
        });
      paymentPeriods.add(period);
    }
  }
  return result;
}
export function saveTemplate(
  data: FinanceData,
  template: PaymentTemplate,
  today = dateKey(),
) {
  const result = structuredClone(data);
  result.templates = [
    ...result.templates.filter((t) => t.id !== template.id),
    template,
  ];
  // Completed, skipped, overdue and individually rescheduled payments preserve their snapshots.
  result.payments = result.payments.filter(
    (p) =>
      p.templateId !== template.id ||
      p.status !== "pending" ||
      p.due < today ||
      p.due !== p.originalDate,
  );
  return expandPayments(result, today);
}
export function accountBalance(data: FinanceData, accountId: string) {
  return data.transactions.reduce(
    (balance, t) =>
      balance +
      (t.kind === "transfer" && t.toAccountId === accountId ? t.amount : 0) +
      (t.accountId === accountId
        ? t.kind === "income"
          ? t.amount
          : -t.amount
        : 0),
    data.accounts.find((a) => a.id === accountId)?.opening || 0,
  );
}
export function saveTransaction(
  data: FinanceData,
  transaction: Transaction,
): FinanceData {
  transaction = {
    ...transaction,
    tags: canonicalTags(data, transaction.kind, transaction.tags),
  };
  const result = structuredClone(data);
  const previous = result.transactions.find((t) => t.id === transaction.id);
  if (
    previous?.occurrenceId &&
    previous.occurrenceId !== transaction.occurrenceId
  )
    throw new Error("Сначала отмените связь с платежом.");
  if (transaction.occurrenceId) {
    const payment = result.payments.find(
      (p) => p.id === transaction.occurrenceId,
    );
    if (
      !payment ||
      transaction.kind !== "expense" ||
      transaction.accountId !== payment.accountId ||
      payment.status === "skipped"
    )
      throw new Error("Проверьте платёж и счёт.");
    if (
      result.transactions.some(
        (t) => t.id !== transaction.id && t.occurrenceId === payment.id,
      )
    )
      throw new Error("Этот платёж уже оплачен. Обновите данные.");
    payment.status = "paid";
  }
  result.transactions = [
    ...result.transactions.filter((t) => t.id !== transaction.id),
    transaction,
  ];
  validateFinance(result);
  return result;
}
export function removeTransaction(data: FinanceData, transactionId: string) {
  const result = structuredClone(data),
    transaction = result.transactions.find((t) => t.id === transactionId);
  result.transactions = result.transactions.filter(
    (t) => t.id !== transactionId,
  );
  if (transaction?.occurrenceId) {
    const payment = result.payments.find(
      (p) => p.id === transaction.occurrenceId,
    );
    if (payment) payment.status = "pending";
  }
  return result;
}
export function validateFinance(data: FinanceData): FinanceData {
  const fail = () => {
    throw new Error("Некорректные финансовые данные.");
  };
  if (
    !data ||
    data.version !== 1 ||
    !["accounts", "categories", "transactions", "templates", "payments"].every(
      (key) => Array.isArray((data as any)[key]),
    )
  )
    fail();
  const unique = (items: { id: string }[]) =>
    items.every((item) => typeof item.id === "string" && !!item.id) &&
    new Set(items.map((i) => i.id)).size === items.length;
  if (
    ![
      data.accounts,
      data.categories,
      data.transactions,
      data.templates,
      data.payments,
    ].every(unique)
  )
    fail();
  const account = (value: string) => data.accounts.some((a) => a.id === value);
  const category = (value: string) =>
    value === "" || data.categories.some((c) => c.id === value);
  const amount = (value: number) => Number.isSafeInteger(value) && value > 0;
  const text = (value: unknown, max = 500) =>
    typeof value === "string" && value.length <= max;
  if (
    !data.accounts.every(
      (a) =>
        text(a.name, 80) &&
        a.name.trim() &&
        ["EUR", "USD", "RUB", "RSD", "GBP"].includes(a.currency) &&
        Number.isSafeInteger(a.opening),
    )
  )
    fail();
  if (
    !data.categories.every((c) => text(c.name, 80) && c.name.trim()) ||
    new Set(data.categories.map((c) => c.name.toLocaleLowerCase())).size !==
      data.categories.length
  )
    fail();
  if (
    !data.templates.every(
      (t) =>
        text(t.title) &&
        t.title.trim() &&
        (t.amount === null || amount(t.amount)) &&
        account(t.accountId) &&
        category(t.categoryId) &&
        Number.isInteger(t.day) &&
        t.day >= 1 &&
        t.day <= 31 &&
        validDate(t.start) &&
        (!t.until || (validDate(t.until) && t.until >= t.start)) &&
        Number.isInteger(t.remindDays) &&
        t.remindDays >= 0 &&
        t.remindDays <= 31 &&
        typeof t.paused === "boolean",
    )
  )
    fail();
  if (
    !data.payments.every(
      (p) =>
        data.templates.some((t) => t.id === p.templateId) &&
        p.id === `${p.templateId}:${p.originalDate}` &&
        validDate(p.originalDate) &&
        validDate(p.due) &&
        text(p.title) &&
        account(p.accountId) &&
        category(p.categoryId) &&
        (p.amount === null || amount(p.amount)) &&
        ["pending", "paid", "skipped"].includes(p.status),
    )
  )
    fail();
  if (
    !data.transactions.every(
      (t) =>
        ["expense", "income", "transfer"].includes(t.kind) &&
        amount(t.amount) &&
        account(t.accountId) &&
        validDate(t.date) &&
        category(t.categoryId) &&
        Array.isArray(t.tags) &&
        t.tags.length <= 30 &&
        t.tags.every((tag) => text(tag, 80)) &&
        text(t.note, 2000) &&
        text(t.occurrenceId) &&
        text(t.toAccountId) &&
        (t.kind !== "transfer" ||
          (account(t.toAccountId) &&
            t.toAccountId !== t.accountId &&
            data.accounts.find((a) => a.id === t.toAccountId)?.currency ===
              data.accounts.find((a) => a.id === t.accountId)?.currency)) &&
        (!t.occurrenceId ||
          (t.kind === "expense" &&
            data.payments.some(
              (p) =>
                p.id === t.occurrenceId &&
                p.status === "paid" &&
                p.accountId === t.accountId,
            ))),
    )
  )
    fail();
  if (data.tags !== undefined) {
    if (
      !Array.isArray(data.tags) ||
      !data.tags.every(
        (tag) =>
          tag &&
          typeof tag.name === "string" &&
          tag.name.trim() === tag.name &&
          !!tag.name &&
          tag.name.length <= 80 &&
          !tag.name.includes(",") &&
          ["expense", "income"].includes(tag.kind) &&
          Number.isInteger(tag.importance) &&
          tag.importance >= 0 &&
          tag.importance <= 5 &&
          (tag.kind !== "income" || tag.importance === 0),
      )
    )
      fail();
    if (
      new Set(data.tags.map((tag) => `${tag.kind}:${tagKey(tag.name)}`))
        .size !== data.tags.length
    )
      fail();
  }
  const linked = data.transactions
    .filter((t) => t.occurrenceId)
    .map((t) => t.occurrenceId);
  if (
    new Set(linked).size !== linked.length ||
    data.payments.some((p) => p.status === "paid" && !linked.includes(p.id))
  )
    fail();
  if (
    data.accounts.some((a) => !Number.isSafeInteger(accountBalance(data, a.id)))
  )
    fail();
  if (data.lastAccountId && !account(data.lastAccountId)) fail();
  validateSavings(data);
  return data;
}
