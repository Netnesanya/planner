import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyFinance,
  saveTransaction,
  removeTransaction,
  validateFinance,
  Transaction,
} from "../src/app/finance/finance";
import {
  importanceAtStar,
  rankedTags,
  storeTag,
} from "../src/app/finance/finance-tags";
const base = () => ({
  ...emptyFinance(),
  accounts: [{ id: "a", name: "Карта", currency: "EUR", opening: 0 }],
});
const operation = (
  id: string,
  kind: Transaction["kind"],
  tags: string[],
): Transaction => ({
  id,
  kind,
  tags,
  amount: 100,
  accountId: "a",
  toAccountId: "",
  date: "2026-11-05",
  categoryId: "",
  note: "",
  occurrenceId: "",
});
test("legacy tags are discovered separately; counts come from distinct matching transactions", () => {
  const data = base();
  data.transactions = [
    operation("a", "expense", ["Дом", "дом"]),
    operation("b", "expense", ["Дом"]),
    operation("c", "expense", ["Кафе"]),
    operation("d", "income", ["Премия", "Дом"]),
  ];
  assert.deepEqual(
    rankedTags(data, "expense").map((t) => [t.name, t.count]),
    [
      ["Дом", 2],
      ["Кафе", 1],
    ],
  );
  assert.deepEqual(
    rankedTags(data, "income").map((t) => [t.name, t.count]),
    [
      ["Дом", 1],
      ["Премия", 1],
    ],
  );
  assert.equal(data.tags, undefined);
});
test("tags may be created before operations; importance is independent of usage order and income names", () => {
  let data = base();
  data = storeTag(data, { kind: "expense", name: "Дом", importance: 5 });
  data = storeTag(data, { kind: "income", name: "Дом", importance: 0 });
  data = storeTag(data, { kind: "expense", name: "Кафе", importance: 1 });
  data = saveTransaction(data, operation("coffee", "expense", ["кафе"]));
  assert.deepEqual(
    rankedTags(data, "expense").map((t) => [t.name, t.importance, t.count]),
    [
      ["Кафе", 1, 1],
      ["Дом", 5, 0],
    ],
  );
  assert.equal(rankedTags(data, "income")[0].importance, 0);
  assert.equal(rankedTags(data, "income")[0].count, 0);
  assert.doesNotThrow(() => validateFinance(JSON.parse(JSON.stringify(data))));
});
test("editing and cancellation recalculate frequency without counting attempts or duplicate names", () => {
  let data = base();
  const original = operation("a", "expense", ["Дом", "дом"]);
  data = saveTransaction(data, original);
  assert.deepEqual(original.tags, ["Дом", "дом"]);
  assert.equal(rankedTags(data, "expense")[0].count, 1);
  assert.deepEqual(data.transactions[0].tags, ["Дом"]);
  data = saveTransaction(data, operation("a", "expense", ["Кафе"]));
  assert.deepEqual(
    rankedTags(data, "expense").map((t) => t.name),
    ["Кафе"],
  );
  data = removeTransaction(data, "a");
  assert.deepEqual(rankedTags(data, "expense"), []);
});
test("importance updates do not rewrite transactions; validation rejects invalid or duplicate registries", () => {
  let data = saveTransaction(base(), operation("a", "expense", ["Дом"]));
  data = storeTag(data, { kind: "expense", name: "дом", importance: 4 });
  assert.equal(data.transactions[0].tags[0], "Дом");
  assert.equal(data.tags![0].name, "Дом");
  assert.throws(() =>
    storeTag(data, { kind: "income", name: "Зарплата", importance: 5 }),
  );
  assert.throws(() =>
    storeTag(data, { kind: "expense", name: "Дом", importance: 6 }),
  );
  assert.throws(() =>
    storeTag(data, { kind: "expense", name: "один,два", importance: 0 }),
  );
  assert.throws(() =>
    validateFinance({ ...data, tags: [...data.tags!, ...data.tags!] }),
  );
});

test("left 30 percent of each star selects the previous integer, including 0; boundary selects the star", () => {
  for (let star = 1; star <= 5; star++) {
    for (const fraction of [0, 0.15, 0.299])
      assert.equal(importanceAtStar(star, fraction), star - 1);
    for (const fraction of [0.3, 0.301, 0.5, 1])
      assert.equal(importanceAtStar(star, fraction), star);
  }
});
