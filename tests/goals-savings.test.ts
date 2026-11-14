import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusedGoals,
  validateGoals,
  type LongGoal,
} from "../src/app/goals/goals";
import {
  emptyFinance,
  validateFinance,
  accountBalance,
  saveTransaction,
} from "../src/app/finance/finance";
import {
  allocateSavings,
  availableOnAccount,
  savedAmount,
} from "../src/app/finance/savings";
const goal = (
  id: string,
  priority: number,
  status: LongGoal["status"] = "active",
): LongGoal => ({
  id,
  title: id,
  priority,
  status,
  why: "",
  next: "",
  deadline: "",
  progress: 0,
  created: "2026-11-05T00:00:00Z",
});
test("podium is the top three active goals, stable on ties and independent of dates", () => {
  const goals = [
    goal("a", 3),
    goal("b", 5),
    goal("c", 4),
    goal("d", 5, "future"),
    goal("e", 5, "done"),
    goal("f", 3),
    goal("g", 5, "paused"),
  ];
  assert.deepEqual(
    focusedGoals(goals).map((g) => g.id),
    ["b", "c", "a"],
  );
  assert.equal(goals[0].id, "a");
  goals[0].priority = 0;
  assert.deepEqual(
    focusedGoals(goals).map((g) => g.id),
    ["b", "c", "f"],
  );
  assert.doesNotThrow(() => validateGoals({ version: 1, goals }));
  assert.throws(() => validateGoals({ version: 1, goals: [goal("a", 6)] }));
  assert.throws(() =>
    validateGoals({
      version: 1,
      goals: [{ ...goal("a", 1), deadline: "2027-02-30" }],
    }),
  );
});
function fixture() {
  const data = emptyFinance();
  data.accounts = [
    { id: "usd", name: "USD", currency: "USD", opening: 10000 },
    { id: "eur", name: "EUR", currency: "EUR", opening: 90000 },
  ];
  data.savings = [
    {
      id: "home",
      title: "Дом",
      currency: "USD",
      target: 15000000,
      allocations: [],
      archived: false,
    },
    {
      id: "trip",
      title: "Поездка",
      currency: "USD",
      target: 100000,
      allocations: [],
      archived: false,
    },
  ];
  return data;
}
test("savings reserve actual money only once without creating expenses or changing balance", () => {
  const original = fixture(),
    first = allocateSavings(original, "home", "usd", 7000);
  assert.equal(savedAmount(first.savings![0]), 7000);
  assert.equal(accountBalance(first, "usd"), 10000);
  assert.equal(first.transactions.length, 0);
  assert.equal(availableOnAccount(first, "usd"), 3000);
  assert.equal(savedAmount(original.savings![0]), 0);
  assert.throws(
    () => allocateSavings(first, "trip", "usd", 3001),
    /недостаточно/,
  );
  const second = allocateSavings(first, "trip", "usd", 3000);
  assert.equal(availableOnAccount(second, "usd"), 0);
  const release = allocateSavings(second, "home", "usd", -2000);
  assert.equal(availableOnAccount(release, "usd"), 2000);
  assert.throws(() => allocateSavings(release, "home", "usd", -6000));
  assert.throws(() => allocateSavings(first, "home", "eur", 1));
  assert.throws(() => allocateSavings(first, "home", "usd", NaN));
});
test("real spending remains possible; a reserve deficit is visible and prevents new allocation", () => {
  let data = allocateSavings(fixture(), "home", "usd", 7000);
  data = saveTransaction(data, {
    id: "expense",
    kind: "expense",
    amount: 6000,
    accountId: "usd",
    toAccountId: "",
    date: "2026-11-05",
    categoryId: "",
    tags: [],
    note: "",
    occurrenceId: "",
  });
  assert.equal(availableOnAccount(data, "usd"), -3000);
  assert.throws(() => allocateSavings(data, "trip", "usd", 1));
  assert.doesNotThrow(() => validateFinance(JSON.parse(JSON.stringify(data))));
});
test("legacy finance books work; invalid allocation currencies, duplicates and archived reserves fail", () => {
  assert.doesNotThrow(() => validateFinance(emptyFinance()));
  const data = allocateSavings(fixture(), "home", "usd", 7000);
  const bad = structuredClone(data);
  bad.savings![0].archived = true;
  assert.throws(() => validateFinance(bad));
  const duplicate = structuredClone(data);
  duplicate.savings![0].allocations.push({ accountId: "usd", amount: 1 });
  assert.throws(() => validateFinance(duplicate));
  const wrong = structuredClone(data);
  wrong.savings![0].allocations[0].accountId = "eur";
  assert.throws(() => validateFinance(wrong));
});
