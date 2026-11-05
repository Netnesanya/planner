import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  Output,
  ViewChild,
  inject,
} from "@angular/core";
import { ExpenseImportanceComponent } from "./expense-importance.component";
import { FormsModule } from "@angular/forms";
import { FinanceData } from "./finance";
import { FinanceTag, rankedTags, TagKind, tagKey } from "./finance-tags";
@Component({
  selector: "app-finance-tag-picker",
  standalone: true,
  imports: [FormsModule, ExpenseImportanceComponent],
  templateUrl: "./finance-tag-picker.component.html",
  styleUrl: "./finance-tag-picker.component.scss",
})
export class FinanceTagPickerComponent {
  @Input({ required: true }) data!: FinanceData;
  @Input({ required: true }) kind: TagKind = "expense";
  @Input() selected: string[] = [];
  @Input() disabled = false;
  @Input() manage = false;
  @Output() selectedChange = new EventEmitter<string[]>();
  @Output() saveTag = new EventEmitter<FinanceTag>();
  @ViewChild("menu") menu?: ElementRef<HTMLDivElement>;
  readonly supportsPopover =
    typeof HTMLElement.prototype.showPopover === "function";
  @ViewChild("searchInput") searchInput?: ElementRef<HTMLInputElement>;
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly panelId = `finance-tags-${crypto.randomUUID()}`;
  open = false;
  query = "";
  importance = 0;
  usage(count: number) {
    const last = count % 10,
      hundred = count % 100;
    const noun =
      last === 1 && hundred !== 11
        ? "запись"
        : last >= 2 && last <= 4 && (hundred < 12 || hundred > 14)
          ? "записи"
          : "записей";
    return `${count} ${noun}`;
  }
  get label() {
    return this.kind === "expense" ? "Теги расходов" : "Теги доходов";
  }
  get items() {
    return rankedTags(this.data, this.kind).filter((tag) =>
      tagKey(tag.name).includes(tagKey(this.query)),
    );
  }
  get canCreate() {
    const name = this.query.trim();
    return (
      !!name &&
      name.length <= 80 &&
      !name.includes(",") &&
      !rankedTags(this.data, this.kind).some(
        (tag) => tagKey(tag.name) === tagKey(name),
      )
    );
  }
  has(name: string) {
    return this.selected.some((value) => tagKey(value) === tagKey(name));
  }
  toggle(name: string) {
    if (this.disabled) return;
    this.selectedChange.emit(
      this.has(name)
        ? this.selected.filter((value) => tagKey(value) !== tagKey(name))
        : [...this.selected, name],
    );
  }
  private readonly reposition = () => this.position();
  constructor() {
    window.visualViewport?.addEventListener("resize", this.reposition);
  }
  ngOnDestroy() {
    window.visualViewport?.removeEventListener("resize", this.reposition);
  }
  position() {
    const menu = this.menu?.nativeElement;
    if (!menu || !this.supportsPopover) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height || innerHeight;
    const offsetTop = viewport?.offsetTop || 0;
    const width = Math.min(rect.width, innerWidth - 24, 440);
    const maxHeight = Math.min(430, viewportHeight - 24);
    const mobile = innerWidth <= 760;
    const top = mobile
      ? offsetTop + viewportHeight - maxHeight - 12
      : Math.max(
          offsetTop + 12,
          Math.min(
            rect.bottom + 8,
            offsetTop + viewportHeight - maxHeight - 12,
          ),
        );
    menu.style.setProperty("--tags-width", `${width}px`);
    menu.style.setProperty(
      "--tags-left",
      `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
    );
    menu.style.setProperty("--tags-top", `${top}px`);
    menu.style.setProperty("--tags-height", `${maxHeight}px`);
  }
  show() {
    if (this.disabled) return;
    if (this.open) {
      this.close();
      return;
    }
    this.open = true;
    this.query = "";
    this.importance = 0;
    setTimeout(() => {
      if (!this.open) return;
      this.position();
      if (this.supportsPopover) this.menu?.nativeElement.showPopover();
      if (matchMedia("(pointer:fine)").matches)
        this.searchInput?.nativeElement.focus();
    }, 0);
  }
  onToggle(event: Event) {
    if ((event as ToggleEvent).newState === "closed") {
      this.open = false;
      this.query = "";
    }
  }
  create() {
    if (this.disabled || !this.canCreate) return;
    this.saveTag.emit({
      name: this.query.trim(),
      kind: this.kind,
      importance: this.kind === "expense" ? this.importance : 0,
    });
  }
  rate(tag: FinanceTag, value: number) {
    this.saveTag.emit({
      ...tag,
      importance: value,
    });
  }
  close(event?: Event) {
    if (this.open) {
      event?.preventDefault();
      event?.stopPropagation();
      if (
        this.supportsPopover &&
        this.menu?.nativeElement.matches(":popover-open")
      )
        this.menu.nativeElement.hidePopover();
      this.open = false;
      this.query = "";
    }
  }
  @HostListener("document:pointerdown", ["$event"]) outside(
    event: PointerEvent,
  ) {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
  @HostListener("keydown.escape", ["$event"]) escape(event: Event) {
    this.close(event);
  }
}
