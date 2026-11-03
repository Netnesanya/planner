import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  ViewChild,
  inject,
} from "@angular/core";
import { durationLabel, parseDuration } from "../models";
import { IconComponent } from "../icon.component";

@Component({
  selector: "app-duration-picker",
  standalone: true,
  imports: [IconComponent],
  templateUrl: "./duration-picker.component.html",
  styleUrl: "./duration-picker.component.scss",
})
export class DurationPickerComponent implements OnChanges {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  @Input() value = 30;
  @Input() label = "Длительность задачи";
  @Input() disabled = false;
  @Input() compact = false;
  @Output() valueChange = new EventEmitter<number>();
  @Output() validChange = new EventEmitter<boolean>();
  @ViewChild("input") input!: ElementRef<HTMLInputElement>;
  @ViewChild("menu") menu!: ElementRef<HTMLElement>;
  readonly presets = [5, 15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
  readonly id = "duration-" + crypto.randomUUID();
  duration = durationLabel;
  draft = "";
  error = "";
  opened = false;
  active = -1;
  ngOnChanges() {
    this.draft = durationLabel(this.value);
  }
  focus() {
    this.input.nativeElement.focus();
    this.show();
  }
  show() {
    if (this.disabled || this.opened) return;
    this.opened = true;
    this.active = -1;
    const rect = this.input.nativeElement.getBoundingClientRect();
    const menu = this.menu.nativeElement;
    menu.showPopover();
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 268)) + "px";
    menu.style.top =
      Math.max(
        8,
        Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 8),
      ) + "px";
  }
  close() {
    this.opened = false;
    this.menu.nativeElement.hidePopover();
  }
  inputChanged(value: string) {
    this.draft = value;
    this.active = -1;
    this.error = "";
    this.validChange.emit(parseDuration(value) !== null);
  }
  choose(value: number) {
    this.draft = durationLabel(value);
    this.error = "";
    this.validChange.emit(true);
    this.close();
    if (value !== this.value) this.valueChange.emit(value);
  }
  commit() {
    const value = parseDuration(this.draft);
    if (value === null) {
      this.error = "От 5 мин до 24 ч. Например: 90, 1:30, 1ч 30м.";
      this.validChange.emit(false);
      this.close();
      return;
    }
    this.choose(value);
  }
  key(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.show();
      this.active =
        (this.active +
          (event.key === "ArrowDown" ? 1 : -1) +
          this.presets.length) %
        this.presets.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (this.opened && this.active >= 0)
        this.choose(this.presets[this.active]);
      else this.commit();
      this.input.nativeElement.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.draft = durationLabel(this.value);
      this.error = "";
      this.validChange.emit(true);
      this.close();
    }
  }
  @HostListener("document:pointerdown", ["$event"]) outside(
    event: PointerEvent,
  ) {
    if (this.opened && !this.host.nativeElement.contains(event.target as Node))
      this.close();
  }
  @HostListener("window:resize") resize() {
    if (this.opened) this.close();
  }
}
