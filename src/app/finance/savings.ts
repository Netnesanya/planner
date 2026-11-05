import { FinanceData, accountBalance } from "./finance";
export interface SavingsGoal {
  id: string;
  title: string;
  currency: string;
  target: number;
  allocations: { accountId: string; amount: number }[];
  archived: boolean;
}
export const savedAmount = (goal: SavingsGoal) =>
  goal.allocations.reduce((sum, a) => sum + a.amount, 0);
export function reservedOnAccount(data: FinanceData, accountId: string) {
  return (data.savings || [])
    .flatMap((g) => g.allocations)
    .filter((a) => a.accountId === accountId)
    .reduce((sum, a) => sum + a.amount, 0);
}
export const availableOnAccount = (data: FinanceData, accountId: string) =>
  accountBalance(data, accountId) - reservedOnAccount(data, accountId);
export function validateSavings(data: FinanceData) {
  if (data.savings === undefined) return;
  if (
    !Array.isArray(data.savings) ||
    data.savings.length > 5000 ||
    new Set(data.savings.map((g) => g?.id)).size !== data.savings.length ||
    data.savings.some(
      (g) =>
        !g ||
        typeof g.id !== "string" ||
        !g.id ||
        typeof g.title !== "string" ||
        !g.title.trim() ||
        g.title.length > 200 ||
        !["USD", "EUR", "RSD", "RUB", "GBP"].includes(g.currency) ||
        !Number.isSafeInteger(g.target) ||
        g.target <= 0 ||
        typeof g.archived !== "boolean" ||
        !Array.isArray(g.allocations) ||
        new Set(g.allocations.map((a) => a?.accountId)).size !==
          g.allocations.length ||
        g.allocations.some(
          (a) =>
            !a ||
            !Number.isSafeInteger(a.amount) ||
            a.amount < 0 ||
            !data.accounts.some(
              (account) =>
                account.id === a.accountId && account.currency === g.currency,
            ),
        ) ||
        !Number.isSafeInteger(savedAmount(g)) ||
        (g.archived && savedAmount(g) > 0),
    )
  )
    throw new Error("Некорректные накопления.");
  for (const account of data.accounts)
    if (!Number.isSafeInteger(reservedOnAccount(data, account.id)))
      throw new Error("Слишком большая сумма накоплений.");
}
/** Earmarking moves no money and creates no expense. It reserves only an unallocated balance. */
export function allocateSavings(
  data: FinanceData,
  goalId: string,
  accountId: string,
  delta: number,
): FinanceData {
  const next = structuredClone(data),
    goal = next.savings?.find((g) => g.id === goalId),
    account = next.accounts.find((a) => a.id === accountId);
  if (
    !goal ||
    goal.archived ||
    !account ||
    account.currency !== goal.currency ||
    !Number.isSafeInteger(delta) ||
    !delta
  )
    throw new Error("Проверьте накопление, счёт и сумму.");
  const allocation = goal.allocations.find((a) => a.accountId === accountId),
    current = allocation?.amount || 0;
  if (delta > 0 && delta > availableOnAccount(next, accountId))
    throw new Error(
      "На счёте недостаточно свободных денег. Учтены резервы других накоплений.",
    );
  if (current + delta < 0)
    throw new Error(
      "Нельзя освободить больше, чем зарезервировано на этом счёте.",
    );
  if (allocation) allocation.amount += delta;
  else goal.allocations.push({ accountId, amount: delta });
  validateSavings(next);
  return next;
}
