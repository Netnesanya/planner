import { parseCalendar } from "./ical-parser";
addEventListener("message", ({ data }) => {
  try {
    postMessage({ result: parseCalendar(data.raw, data.range) });
  } catch (error) {
    postMessage({
      error: (error as Error).message || "Не удалось прочитать файл.",
    });
  }
});
