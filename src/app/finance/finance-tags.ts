import type { FinanceData, Transaction } from "./finance";
export type TagKind = "expense" | "income";
export interface FinanceTag {
  name: string;
  kind: TagKind;
  importance: number;
}
export const tagKey = (value: string) =>
  value.trim().toLocaleLowerCase("ru-RU");
export const IMPORTANCE_LABELS = [
  "вредное",
  "лишнее",
  "иногда можно",
  "допустимо",
  "важно",
  "необходимо",
];
/** The first 30% of the glyph selects the previous integer, including zero. */
export function importanceAtStar(star: number, fraction: number) {
  return Math.max(0, Math.min(5, fraction < 0.3 - 1e-9 ? star - 1 : star));
}
/** Derive counts from actual transactions; cancellation and editing cannot inflate popularity. */
export function rankedTags(data: FinanceData, kind: TagKind) {
  const tags = new Map<string, FinanceTag & { count: number }>();
  for (const tag of data.tags || [])
    if (tag.kind === kind) tags.set(tagKey(tag.name), { ...tag, count: 0 });
  for (const transaction of data.transactions) {
    if (transaction.kind !== kind) continue;
    for (const key of new Set(transaction.tags.map(tagKey).filter(Boolean))) {
      if (!tags.has(key))
        tags.set(key, {
          name: transaction.tags.find((name) => tagKey(name) === key)!.trim(),
          kind,
          importance: 0,
          count: 0,
        });
      tags.get(key)!.count++;
    }
  }
  return [...tags.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"),
  );
}
export function storeTag(data: FinanceData, tag: FinanceTag): FinanceData {
  const name = tag.name.trim();
  if (
    !name ||
    name.length > 80 ||
    name.includes(",") ||
    !["expense", "income"].includes(tag.kind) ||
    !Number.isInteger(tag.importance) ||
    tag.importance < 0 ||
    tag.importance > 5 ||
    (tag.kind === "income" && tag.importance !== 0)
  )
    throw new Error(
      "Укажите название тега до 80 символов и оценку от 0 до 5 звёзд.",
    );
  const result = structuredClone(data);
  const existing = rankedTags(result, tag.kind).find(
    (item) => tagKey(item.name) === tagKey(name),
  );
  result.tags = [
    ...(result.tags || []).filter(
      (item) => item.kind !== tag.kind || tagKey(item.name) !== tagKey(name),
    ),
    {
      name: existing?.name || name,
      kind: tag.kind,
      importance: tag.importance,
    },
  ];
  return result;
}
export function canonicalTags(
  data: FinanceData,
  kind: Transaction["kind"],
  names: string[],
) {
  const known = kind === "transfer" ? [] : rankedTags(data, kind);
  const selected = new Map<string, string>();
  for (const name of names) {
    const key = tagKey(name);
    if (key && !selected.has(key))
      selected.set(
        key,
        known.find((tag) => tagKey(tag.name) === key)?.name || name.trim(),
      );
  }
  return [...selected.values()];
}
