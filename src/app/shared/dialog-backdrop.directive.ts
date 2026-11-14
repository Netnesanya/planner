import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  inject,
} from "@angular/core";
/** Native dialog backdrops target the dialog itself; padding inside the box is not a backdrop. */
@Directive({ selector: "dialog[appCloseOnBackdrop]", standalone: true })
export class DialogBackdropDirective {
  private readonly element = inject(ElementRef<HTMLDialogElement>);
  private startedOutside = false;
  @Output() backdropClose = new EventEmitter<void>();
  private outside(event: MouseEvent) {
    const dialog = this.element.nativeElement;
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  @HostListener("pointerdown", ["$event"]) pointerDown(event: PointerEvent) {
    this.startedOutside = this.outside(event);
  }
  @HostListener("click", ["$event"]) click(event: MouseEvent) {
    const dismiss =
      event.detail > 0 && this.startedOutside && this.outside(event);
    this.startedOutside = false;
    if (dismiss) this.backdropClose.emit();
  }
}
