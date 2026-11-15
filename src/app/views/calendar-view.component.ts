import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  HostListener,
  OnDestroy,
  signal,
} from "@angular/core";
import { IconComponent } from "../icon.component";
import { TaskViewBase } from "../shared/task-view.base";
import {
  addDays,
  dateKey,
  parseDate,
  positionEvents,
  Task,
  weekStart,
} from "../models";
import { CalendarBacklogComponent } from "./calendar-backlog.component";
import { FormsModule } from "@angular/forms";
import { dayLoad } from "../planner-workflows";
interface ResizeState {
  task: Task;
  startY: number;
  minutes: number;
  scrollTop: number;
}
@Component({
  selector: "app-calendar-view",
  standalone: true,
  imports: [IconComponent, FormsModule, CalendarBacklogComponent],
  templateUrl: "./calendar-view.component.html",
  styleUrl: "./calendar-view.component.scss",
})
export class CalendarViewComponent
  extends TaskViewBase
  implements AfterViewInit, OnDestroy
{
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  moving = signal<{
    task: Task;
    startX: number;
    startY: number;
    grabOffset: number;
    date: string | null;
    minute: number;
    active: boolean;
    allDay: boolean;
    valid: boolean;
  } | null>(null);
  private lastPointer: { x: number; y: number } | null = null;
  private scrollFrame = 0;
  ignoreClick = false;
  backlogOpen = true;
  capacity = this.store.preferences().dailyCapacityHours || 8;
  saveCapacity() {
    this.capacity = Math.max(1, Math.min(24, Number(this.capacity) || 8));
    void this.store.savePreferences({ dailyCapacityHours: this.capacity });
  }
  get backlogTasks() {
    const days = this.calendarDays;
    return this.tasks.filter(
      (t) =>
        !t.is_milestone &&
        t.status !== "done" &&
        (!t.due_date || (!t.start_time && days.includes(t.due_date))),
    );
  }
  load(date: string) {
    return dayLoad(this.tasks, date);
  }
  async schedule(request: { task: Task; date: string; time: string }) {
    const [h, m] = (request.time || "00:00").split(":").map(Number);
    if (request.time && h * 60 + m + request.task.duration > 1440) {
      this.store.error.set(
        "Задача не помещается до конца дня. Выберите более раннее время.",
      );
      return;
    }
    await this.store.saveTask({
      ...request.task,
      due_date: request.date,
      start_time: request.time || null,
    });
  }
  selectedDate = dateKey();
  calendarMode: "week" | "day" | "month" = "week";
  now = signal(new Date());
  resizing = signal<ResizeState | null>(null);
  private timer = setInterval(() => this.now.set(new Date()), 60000);
  hours = Array.from({ length: 24 }, (_, i) => i);
  weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  calendarModes: { id: "day" | "week" | "month"; label: string }[] = [
    { id: "day", label: "День" },
    { id: "week", label: "Неделя" },
    { id: "month", label: "Месяц" },
  ];
  get timezoneLabel() {
    const offset = -this.now().getTimezoneOffset() / 60;
    return "GMT" + (offset >= 0 ? "+" : "") + offset;
  }
  get calendarDays() {
    const start =
      this.calendarMode === "day"
        ? this.selectedDate
        : weekStart(this.selectedDate);
    return Array.from({ length: this.calendarMode === "day" ? 1 : 7 }, (_, i) =>
      addDays(start, i),
    );
  }
  get monthDays() {
    const start = weekStart(this.selectedDate.slice(0, 7) + "-01");
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }
  get calendarTitle() {
    return this.dateLabel(this.selectedDate, {
      month: "long",
      year: "numeric",
    }).replace(" г.", "");
  }
  dateTasks(date: string, timed?: boolean) {
    return this.tasks.filter(
      (t) =>
        t.due_date === date &&
        (this.store.preferences().showCompleted || t.status !== "done") &&
        (timed === undefined || !!t.start_time === timed),
    );
  }
  events(date: string) {
    return positionEvents(
      this.dateTasks(date, true).map((t) =>
        t.id === this.resizing()?.task.id
          ? { ...t, duration: this.resizing()!.minutes }
          : t,
      ),
    );
  }
  shiftDate(direction: number) {
    if (this.calendarMode === "month") {
      const d = parseDate(this.selectedDate);
      d.setDate(1);
      d.setMonth(d.getMonth() + direction);
      this.selectedDate = dateKey(d);
    } else
      this.selectedDate = addDays(
        this.selectedDate,
        direction * (this.calendarMode === "day" ? 1 : 7),
      );
  }
  setCalendarMode(mode: "week" | "day" | "month") {
    this.calendarMode = mode;
    this.scrollCalendar();
  }
  scrollCalendar() {
    setTimeout(() => {
      const el = document.querySelector(".calendar-scroll");
      if (el) el.scrollTop = 7 * 64;
    }, 0);
  }
  ngAfterViewInit() {
    this.scrollCalendar();
  }
  ngOnDestroy() {
    clearInterval(this.timer);
    cancelAnimationFrame(this.scrollFrame);
  }
  async dropTime(event: DragEvent, date: string, hour: number) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = Math.max(
      0,
      Math.min(45, Math.floor((event.clientY - rect.top) / 16) * 15),
    );
    await this.dropDate(event, date, hour, minutes);
  }
  async dropAllDay(event: DragEvent, date: string) {
    event.preventDefault();
    const task = this.store
      .tasks()
      .find((t) => t.id === event.dataTransfer?.getData("text/plain"));
    if (task)
      await this.store.saveTask({
        ...task,
        due_date: date,
        repeat_anchor: Number(date.slice(8)),
        start_time: null,
      });
  }
  timeLabel(minute: number) {
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }
  startMove(event: PointerEvent, task: Task) {
    if (task.is_milestone) {
      this.ignoreClick = false;
      return;
    }
    if (event.button !== 0 || this.store.busy() || this.resizing()) return;
    const element = event.currentTarget as HTMLElement;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    const [h, m] = (task.start_time || "00:00").split(":").map(Number);
    this.ignoreClick = false;
    this.moving.set({
      task,
      startX: event.clientX,
      startY: event.clientY,
      grabOffset: event.clientY - rect.top,
      date: task.due_date || this.selectedDate,
      minute: h * 60 + m,
      active: false,
      allDay: !task.start_time,
      valid: true,
    });
  }
  private updateMove(x: number, y: number) {
    const state = this.moving();
    if (!state) return;
    const active =
      state.active || Math.hypot(x - state.startX, y - state.startY) >= 5;
    if (!active) return;
    this.ignoreClick = true;
    const backlog = this.host.nativeElement
      .querySelector<HTMLElement>("[data-calendar-backlog]")
      ?.getBoundingClientRect();
    if (
      backlog &&
      x >= backlog.left &&
      x <= backlog.right &&
      y >= backlog.top &&
      y <= backlog.bottom
    ) {
      this.moving.set({
        ...state,
        active,
        allDay: true,
        valid: true,
        date: null,
      });
      return;
    }
    const allDay = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        "[data-all-day-date]",
      ),
    ).find((el) => {
      const rect = el.getBoundingClientRect();
      return (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      );
    });
    if (allDay) {
      this.moving.set({
        ...state,
        active,
        allDay: true,
        valid: true,
        date: allDay.dataset["allDayDate"]!,
      });
      return;
    }
    const visible = this.host.nativeElement
      .querySelector<HTMLElement>(".calendar-scroll")!
      .getBoundingClientRect();
    if (
      y < visible.top ||
      y > visible.bottom ||
      x < visible.left ||
      x > visible.right
    ) {
      this.moving.set({ ...state, active, valid: false });
      return;
    }
    const columns = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        ".calendar-day-column",
      ),
    );
    const column = columns.find((el) => {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right;
    });
    if (!column) {
      this.moving.set({ ...state, active, valid: false });
      return;
    }
    const index = columns.indexOf(column);
    // Convert the card's top edge, including grab offset, to local calendar minutes.
    const raw =
      ((y - column.getBoundingClientRect().top - state.grabOffset) / 64) * 60;
    const minute = Math.max(
      0,
      Math.min(
        Math.floor((1440 - state.task.duration) / 15) * 15,
        Math.round(raw / 15) * 15,
      ),
    );
    this.moving.set({
      ...state,
      active,
      date: this.calendarDays[index],
      minute,
      allDay: false,
      valid: true,
    });
  }
  private autoScroll = () => {
    if (!this.moving()?.active && !this.resizing()) return;
    const scroller =
      this.host.nativeElement.querySelector<HTMLElement>(".calendar-scroll");
    if (scroller && this.lastPointer) {
      const rect = scroller.getBoundingClientRect();
      const y = this.lastPointer.y;
      const inside =
        this.lastPointer.x >= rect.left &&
        this.lastPointer.x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;
      const delta = inside
        ? y < rect.top + 40
          ? -8
          : y > rect.bottom - 40
            ? 8
            : 0
        : 0;
      if (delta) {
        scroller.scrollTop += delta;
        if (this.moving()) this.updateMove(this.lastPointer.x, y);
        else this.updateResize(y);
      }
    }
    this.scrollFrame = requestAnimationFrame(this.autoScroll);
  };
  startResize(event: PointerEvent, task: Task) {
    if (this.store.busy()) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing.set({
      task,
      startY: event.clientY,
      minutes: task.duration,
      scrollTop:
        this.host.nativeElement.querySelector(".calendar-scroll")!.scrollTop,
    });
    this.lastPointer = { x: event.clientX, y: event.clientY };
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(this.autoScroll);
  }
  @HostListener("document:pointermove", ["$event"]) moveResize(
    event: PointerEvent,
  ) {
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (this.moving()) {
      this.updateMove(event.clientX, event.clientY);
      if (this.moving()?.active) {
        cancelAnimationFrame(this.scrollFrame);
        this.scrollFrame = requestAnimationFrame(this.autoScroll);
      }
    } else this.updateResize(event.clientY);
  }
  private updateResize(y: number) {
    const state = this.resizing();
    if (!state) return;
    const scroll =
      this.host.nativeElement.querySelector(".calendar-scroll")!.scrollTop -
      state.scrollTop;
    const [h, m] = (state.task.start_time || "00:00").split(":").map(Number);
    const minutes = Math.max(
      5,
      Math.min(
        1440 - h * 60 - m,
        Math.round(
          (state.task.duration + ((y - state.startY + scroll) / 64) * 60) / 15,
        ) * 15,
      ),
    );
    this.resizing.set({ ...state, minutes });
  }
  @HostListener("document:pointerup") async finishResize() {
    cancelAnimationFrame(this.scrollFrame);
    const moving = this.moving();
    this.moving.set(null);
    if (moving?.active) {
      const latest = this.store.tasks().find((t) => t.id === moving.task.id);
      const start = moving.allDay ? null : this.timeLabel(moving.minute);
      if (
        latest &&
        moving.valid &&
        (latest.due_date !== moving.date || latest.start_time !== start)
      )
        await this.store.saveTask({
          ...latest,
          due_date: moving.date,
          start_time: start,
          repeat_anchor: moving.date ? Number(moving.date.slice(8)) : null,
        });
      setTimeout(() => (this.ignoreClick = false), 0);
      return;
    }
    const state = this.resizing();
    if (!state) return;
    this.resizing.set(null);
    if (state.minutes !== state.task.duration)
      await this.store.patchTask(state.task.id, { duration: state.minutes });
  }
  @HostListener("document:pointercancel") cancelResize() {
    this.resizing.set(null);
    this.moving.set(null);
    cancelAnimationFrame(this.scrollFrame);
  }
  @HostListener("document:keydown.escape") escapeResize() {
    this.cancelResize();
    this.ignoreClick = true;
  }
  resizeKey(event: KeyboardEvent, task: Task) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const [hour, minute] = (task.start_time || "00:00")
        .split(":")
        .map(Number);
      void this.store.patchTask(task.id, {
        duration: Math.max(
          5,
          Math.min(
            1440 - hour * 60 - minute,
            task.duration + (event.key === "ArrowDown" ? 15 : -15),
          ),
        ),
      });
    }
  }
}
