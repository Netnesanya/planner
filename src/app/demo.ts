import { addDays, dateKey, makeTask, PlannerData, TaskList } from "./models";
export function createDemo(): PlannerData {
  const lists: TaskList[] = [
    {
      id: crypto.randomUUID(),
      name: "Входящие",
      color: "#8bcdd3",
      owner_id: "local",
    },
    {
      id: crypto.randomUUID(),
      name: "Работа",
      color: "#a7b9f5",
      owner_id: "local",
    },
    {
      id: crypto.randomUUID(),
      name: "Личное",
      color: "#e5b8ee",
      owner_id: "local",
    },
    {
      id: crypto.randomUUID(),
      name: "Наши планы",
      color: "#edc691",
      owner_id: "local",
      shared: true,
    },
  ];
  const today = dateKey();
  const entries: [
    string,
    number,
    number | null,
    string | null,
    number,
    number,
    string[],
    string?,
  ][] = [
    ["Спокойное утро и план на день", 2, 0, "08:00", 30, 0, ["привычки"]],
    [
      "Доработать концепцию проекта",
      1,
      0,
      "10:00",
      90,
      3,
      ["фокус", "дизайн"],
      "Собрать мысли в одну понятную историю.\n\nПосмотреть референсы, выделить главное и подготовить финальный вариант.",
    ],
    ["Обсудить планы на неделю", 1, 0, "12:00", 45, 2, ["команда"]],
    ["Прочитать главу книги", 2, 0, null, 30, 0, ["для себя"]],
    ["Купить продукты для ужина", 3, 0, "18:00", 45, 1, ["дом"]],
    ["Вечерняя прогулка", 2, 0, "19:30", 60, 0, ["здоровье"]],
    ["Разобрать почту", 1, 0, "09:00", 20, 0, []],
    ["Записать идеи для выходных", 3, 0, null, 15, 0, ["идеи"]],
    ["Подготовить презентацию", 1, 1, "11:00", 120, 3, ["фокус"]],
    ["Тренировка", 2, 1, "18:30", 60, 1, ["здоровье"]],
    ["Спланировать поездку", 3, 2, "14:00", 90, 1, ["путешествия"]],
    ["Обновить портфолио", 1, 3, "10:00", 120, 2, ["дизайн"]],
    ["Найти новый рецепт пасты", 0, null, null, 20, 0, ["идеи"]],
    ["Посмотреть курс по фотографии", 0, null, null, 45, 0, ["для себя"]],
  ];
  const tasks = entries.map(
    ([title, list, day, time, duration, priority, tags, notes], i) => ({
      ...makeTask(
        lists[list].id,
        "local",
        day === null ? null : addDays(today, day),
      ),
      title,
      start_time: time,
      duration,
      priority: priority as 0 | 1 | 2 | 3,
      tags,
      notes: notes || "",
      status: ([0, 6, 7].includes(i) ? "done" : i === 1 ? "doing" : "todo") as
        "todo" | "doing" | "done",
      completed_at: [0, 6, 7].includes(i) ? `${today}T08:30:00` : null,
      recurrence: (i === 5 ? "daily" : "none") as "daily" | "none",
      repeat_anchor: null,
      subtasks:
        i === 1
          ? [
              {
                id: crypto.randomUUID(),
                title: "Собрать референсы",
                done: true,
              },
              {
                id: crypto.randomUUID(),
                title: "Проработать основные экраны",
                done: false,
              },
              {
                id: crypto.randomUUID(),
                title: "Подготовить к обсуждению",
                done: false,
              },
            ]
          : [],
    }),
  );
  for (let days = 1; days <= 28; days++) {
    const count = (days * 7 + 3) % 6;
    for (let n = 0; n < count; n++) {
      const date = addDays(today, -days);
      tasks.push({
        ...makeTask(lists[(n % 3) + 1].id, "local", date),
        title: [
          "Утренняя зарядка",
          "Завершить рабочие задачи",
          "Почитать книгу",
          "Порядок в заметках",
          "Прогулка",
        ][n],
        duration: [20, 90, 30, 15, 45][n],
        priority: 0,
        status: "done",
        completed_at: `${date}T17:00:00`,
        tags: [],
        start_time: null,
        notes: "",
        recurrence: "none",
        repeat_anchor: null,
        subtasks: [],
      });
    }
  }
  return { version: 1, lists, tasks };
}
