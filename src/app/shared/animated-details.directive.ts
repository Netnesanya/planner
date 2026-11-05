import { Directive, ElementRef, HostListener, inject } from "@angular/core";
/** Animate real layout height so a containing dialog grows and shrinks with the disclosure. */
@Directive({ selector: "details[appAnimatedDetails]", standalone: true })
export class AnimatedDetailsDirective {
  private readonly details = inject(ElementRef<HTMLDetailsElement>)
    .nativeElement;
  private animation?: Animation;
  private dialogAnimation?: Animation;
  private target: boolean | null = null;
  private dialog: HTMLDialogElement | null = null;
  private readonly stopOnClose = () => {
    this.animation?.cancel();
    this.dialogAnimation?.cancel();
    this.dialogAnimation = undefined;
    if (this.dialog) this.dialog.style.height = "";
    this.animation = undefined;
    this.target = null;
    this.details.style.height = "";
    this.details.style.overflow = "";
  };
  ngAfterViewInit() {
    this.dialog = this.details.closest("dialog");
    this.dialog?.addEventListener("close", this.stopOnClose);
  }
  @HostListener("click", ["$event"]) toggle(event: MouseEvent) {
    const summary = this.details.querySelector("summary");
    if (!summary?.contains(event.target as Node)) return;
    event.preventDefault();
    this.setOpen(!(this.target ?? this.details.open), summary);
  }
  private setOpen(open: boolean, summary: HTMLElement) {
    const start = this.details.getBoundingClientRect().height;
    const dialogStart = this.dialog?.getBoundingClientRect().height;
    this.animation?.cancel();
    this.dialogAnimation?.cancel();
    if (this.dialog) this.dialog.style.height = "";
    this.target = open;
    if (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !this.details.animate
    ) {
      this.finish(open);
      return;
    }
    this.details.open = true;
    this.details.style.height = "auto";
    const style = getComputedStyle(this.details);
    const edges =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    const end = open
      ? this.details.getBoundingClientRect().height
      : summary.getBoundingClientRect().height + edges;
    this.details.style.overflow = "hidden";
    this.details.style.height = `${end}px`;
    const dialogEnd = this.dialog?.getBoundingClientRect().height;
    this.details.style.height = `${start}px`;
    // Animate the clamped window separately; otherwise it reaches max-height in the first frame.
    if (this.dialog && dialogStart !== undefined && dialogEnd !== undefined) {
      this.dialog.style.height = `${dialogStart}px`;
      this.dialogAnimation = this.dialog.animate(
        { height: [`${dialogStart}px`, `${dialogEnd}px`] },
        { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
      );
    }
    const animation = this.details.animate(
      { height: [`${start}px`, `${end}px`] },
      { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
    );
    this.animation = animation;
    animation.onfinish = () => {
      if (this.animation === animation) this.finish(open);
    };
  }
  private finish(open: boolean) {
    this.details.open = open;
    this.details.style.height = "";
    this.details.style.overflow = "";
    this.animation?.cancel();
    this.dialogAnimation?.cancel();
    this.dialogAnimation = undefined;
    if (this.dialog) this.dialog.style.height = "";
    this.animation = undefined;
    this.target = null;
  }
  ngOnDestroy() {
    this.animation?.cancel();
    this.dialogAnimation?.cancel();
    this.dialog?.removeEventListener("close", this.stopOnClose);
  }
}
