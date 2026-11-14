import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyFinance,
  parseMoney,
  monthlyDate,
  saveTemplate,
  expandPayments,
  saveTransaction,
  removeTransaction,
  accountBalance,
  validateFinance,
  Transaction,
  PaymentTemplate,
} from "../src/app/finance/finance";
const base = () => ({
  ...emptyFinance(),
  accounts: [
    { id: "a", name: "Карта", currency: "EUR", opening: 100000 },
    { id: "b", name: "Наличные", currency: "EUR", opening: 0 },
    { id: "c", name: "Доллары", currency: "USD", opening: 0 },
  ],
});
const template: PaymentTemplate = {
  id: "rent",
  title: "Аренда",
  amount: 80000,
  accountId: "a",
  categoryId: "",
  day: 31,
  start: "2028-01-01",
  until: "",
  paused: false,
  remindDays: 3,
};
const transaction: Transaction = {
  id: "t",
  kind: "expense",
  amount: 80000,
  accountId: "a",
  toAccountId: "",
  date: "2028-01-31",
  categoryId: "",
  tags: [],
  note: "",
  occurrenceId: "",
};
test("money uses exact minor units, rejects excess decimals, zero and unsafe integers", () => {
  assert.equal(parseMoney("1 234,56"), 123456);
  assert.equal(parseMoney("0.01"), 1);
  for (const raw of ["0", "-1", "1.234", "NaN", "1e3", "99999999999999999"])
    assert.equal(parseMoney(raw), null);
});
test("monthly anchor handles leap years, short months and returns to 31st", () => {
  assert.equal(monthlyDate("2028-02", 31), "2028-02-29");
  assert.equal(monthlyDate("2027-02", 31), "2027-02-28");
  assert.equal(monthlyDate("2028-03", 31), "2028-03-31");
  const data = saveTemplate(base(), template, "2028-01-01");
  assert.ok(data.payments.some((p) => p.due === "2028-02-29"));
  assert.ok(data.payments.some((p) => p.due === "2028-03-31"));
  assert.deepEqual(expandPayments(data, "2028-01-01"), data);
});
test("payment confirmation is unique and undo reopens it without losing schedule", () => {
  let data = saveTemplate(base(), template, "2028-01-01");
  const payment = data.payments[0];
  data = saveTransaction(data, { ...transaction, occurrenceId: payment.id });
  assert.equal(accountBalance(data, "a"), 20000);
  assert.throws(() =>
    saveTransaction(data, {
      ...transaction,
      id: "duplicate",
      occurrenceId: payment.id,
    }),
  );
  data = saveTransaction(data, {
    ...transaction,
    amount: 75000,
    occurrenceId: payment.id,
  });
  assert.equal(data.transactions.length, 1);
  assert.equal(accountBalance(data, "a"), 25000);
  data = removeTransaction(data, "t");
  assert.equal(data.payments[0].status, "pending");
  assert.equal(accountBalance(data, "a"), 100000);
});
test("moving, skipping, pausing and future price changes preserve historical payment snapshots", () => {
  let data = saveTemplate(base(), template, "2028-01-01");
  const january = data.payments.find((p) => p.due === "2028-01-31")!;
  data = saveTransaction(data, { ...transaction, occurrenceId: january.id });
  const feb = data.payments.find((p) => p.due === "2028-02-29")!;
  feb.due = "2028-03-02";
  const march = data.payments.find((p) => p.due === "2028-03-31")!;
  march.status = "skipped";
  data = saveTemplate(data, { ...template, amount: 90000 }, "2028-02-01");
  assert.equal(data.payments.find((p) => p.id === january.id)!.amount, 80000);
  assert.equal(data.payments.find((p) => p.id === feb.id)!.due, "2028-03-02");
  assert.equal(data.payments.find((p) => p.id === march.id)!.status, "skipped");
  assert.equal(
    data.payments.find((p) => p.due === "2028-04-30")!.amount,
    90000,
  );
  data = saveTemplate(data, { ...template, paused: true }, "2028-02-01");
  assert.ok(!data.payments.some((p) => p.due === "2028-04-30"));
  assert.equal(
    expandPayments(data, "2028-03-01").payments.length,
    data.payments.length,
  );
  data = saveTemplate(data, template, "2028-02-01");
  assert.equal(data.payments.filter((p) => p.id === feb.id).length, 1);
  assert.equal(data.payments.find((p) => p.id === march.id)!.status, "skipped");
});
test("transfers move balances, do not become income or expenses and require matching currencies", () => {
  const data = saveTransaction(base(), {
    ...transaction,
    kind: "transfer",
    toAccountId: "b",
    amount: 25000,
  });
  assert.equal(accountBalance(data, "a"), 75000);
  assert.equal(accountBalance(data, "b"), 25000);
  assert.equal(
    data.transactions.filter((t) => t.kind === "expense" || t.kind === "income")
      .length,
    0,
  );
  assert.throws(() =>
    saveTransaction(base(), {
      ...transaction,
      kind: "transfer",
      toAccountId: "c",
    }),
  );
  assert.throws(() =>
    saveTransaction(base(), {
      ...transaction,
      kind: "transfer",
      toAccountId: "a",
    }),
  );
});
test("backup validation rejects broken references, duplicate links, invalid dates and malformed categories", () => {
  const data = saveTemplate(base(), template, "2028-01-01");
  assert.doesNotThrow(() => validateFinance(data));
  assert.throws(() =>
    validateFinance({
      ...data,
      transactions: [{ ...transaction, accountId: "missing" }],
    }),
  );
  assert.throws(() =>
    validateFinance({
      ...data,
      transactions: [{ ...transaction, date: "2028-02-30" }],
    }),
  );
  assert.throws(() =>
    validateFinance({
      ...data,
      categories: [
        { id: "one", name: "Дом" },
        { id: "two", name: "дом" },
      ],
    }),
  );
  data.payments[0].status = "paid";
  assert.throws(() => validateFinance(data));
});
test("end date stops future schedule and unknown amounts require explicit actual transaction amounts", () => {
  const data = saveTemplate(
    base(),
    { ...template, amount: null, until: "2028-03-31" },
    "2028-01-01",
  );
  assert.equal(data.payments.length, 3);
  assert.ok(data.payments.every((p) => p.amount === null));
  assert.throws(() =>
    saveTransaction(data, {
      ...transaction,
      amount: 0,
      occurrenceId: data.payments[0].id,
    }),
  );
  assert.equal(
    saveTransaction(data, { ...transaction, occurrenceId: data.payments[0].id })
      .transactions[0].amount,
    80000,
  );
});

test("changing monthly day never adds a second payment to an already settled month", () => {
  let data = saveTemplate(base(), template, "2028-01-01");
  const january = data.payments.find((p) => p.due === "2028-01-31")!;
  data = saveTransaction(data, { ...transaction, occurrenceId: january.id });
  data = saveTemplate(data, { ...template, day: 15 }, "2028-01-01");
  assert.equal(
    data.payments.filter((p) => p.originalDate.startsWith("2028-01")).length,
    1,
  );
  assert.ok(data.payments.some((p) => p.due === "2028-02-15"));
});
