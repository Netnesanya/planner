import { Component, Input } from "@angular/core";
const PATHS: Record<string, string> = {
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  inbox: "M4 4h16l2 11v5H2v-5L4 4Zm-2 11h6l2 3h4l2-3h6",
  calendar:
    "M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18M7 15h2m4 0h2m-8 3h2",
  list: "M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01",
  kanban: "M3 4h18v16H3V4Zm6 0v16m6-16v16M5 8h2m4 0h2m4 0h2M5 12h2m6 0h-2",
  timeline: "M7 3v18m5-18v18m5-18v18M3 6h11v3H3V6Zm7 9h11v3H10v-3",
  check: "m5 12 4 4L19 6",
  checkcircle: "m8 12 3 3 5-6M21 12a9 9 0 1 1-9-9",
  chart: "M4 20V10m8 10V4m8 16v-7M2 21h20",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.5 4.5L21 21",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-5h4l1 3 3-1 2 3-2 3 2 3-2 3-3-1-1 3h-4l-1-3-3 1-2-3 2-3-2-3 2-3 3 1 1-3Z",
  tag: "M3 3h8l10 10-8 8L3 11V3Zm4 4h.01",
  flag: "M5 21V3h14l-3 5 3 5H5",
  repeat:
    "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3",
  users:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm5-4a4 4 0 0 1 0 8",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  cloud: "M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 1 1 0 11H6",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  menu: "M4 6h16M4 12h16M4 18h16",
  folder: "M3 6V4h6l3 3h9v13H3V6",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8l1-7",
  logout: "M9 4H3v16h6m5-4 4-4-4-4m-6 4h13",
  play: "m8 4 12 8-12 8V4",
  pause: "M8 4v16m8-16v16",
  leaf: "M20 3C8 1 1 9 5 16c6 8 16 1 15-13ZM5 20 15 9",
  lock: "M6 10V7a6 6 0 0 1 12 0v3M4 10h16v11H4V10Zm8 4v3",
};
@Component({
  selector: "app-icon",
  standalone: true,
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="path" />
  </svg>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        line-height: 0;
        width: 18px;
        height: 18px;
      }
      svg {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class IconComponent {
  @Input() name = "list";
  get path() {
    return PATHS[this.name] || PATHS["list"];
  }
}
