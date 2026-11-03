import { computed, Injectable, signal } from "@angular/core";
@Injectable({ providedIn: "root" })
export class FocusService {
  minutes = 25;
  taskId = "";
  remaining = signal(25 * 60);
  running = signal(false);
  private end = 0;
  label = computed(
    () =>
      `${String(Math.floor(this.remaining() / 60)).padStart(2, "0")}:${String(this.remaining() % 60).padStart(2, "0")}`,
  );
  constructor() {
    setInterval(() => {
      if (this.running()) {
        this.remaining.set(
          Math.max(0, Math.ceil((this.end - Date.now()) / 1000)),
        );
        if (!this.remaining()) this.running.set(false);
      }
    }, 1000);
  }
  toggle() {
    if (this.running()) this.running.set(false);
    else {
      if (!this.remaining()) this.remaining.set(this.minutes * 60);
      this.end = Date.now() + this.remaining() * 1000;
      this.running.set(true);
    }
  }
  reset() {
    this.running.set(false);
    this.remaining.set(this.minutes * 60);
  }
}
