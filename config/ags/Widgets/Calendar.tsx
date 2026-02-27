import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { Variable } from "../utils/Variable";

// ── Storage ───────────────────────────────────────────────────────────────────

const DATA_DIR = `${GLib.get_home_dir()}/.local/share/ags`;
const EVENTS_FILE = `${DATA_DIR}/calendar-events.json`;
const SUBS_FILE = `${DATA_DIR}/calendar-subscriptions.json`;

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  time?: string; // "HH:MM" — omit for all-day
  description?: string;
  color?: string;
  sourceId?: string; // set when imported from a subscription
  recurrence?: RecurrenceFreq; // repeat frequency
  recurrenceEnd?: string; // "YYYY-MM-DD" — last date to generate instances (inclusive)
}

export interface CalendarSubscription {
  id: string;
  name: string;
  url: string;
  color: string;
  lastSync?: string;
}

function ensureDir() {
  GLib.mkdir_with_parents(DATA_DIR, 0o755);
}

function readJson<T>(path: string, fallback: T): T {
  try {
    const [ok, raw] = GLib.file_get_contents(path);
    if (ok) return JSON.parse(new TextDecoder().decode(raw)) as T;
  } catch (_) {}
  return fallback;
}

function writeJson(path: string, value: unknown) {
  ensureDir();
  GLib.file_set_contents(path, JSON.stringify(value, null, 2));
}

function uuid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Reactive state ────────────────────────────────────────────────────────────

export const calendarEvents = new Variable<CalendarEvent[]>(
  readJson(EVENTS_FILE, []),
);
export const calendarSubscriptions = new Variable<CalendarSubscription[]>(
  readJson(SUBS_FILE, []),
);

calendarEvents.subscribe((v) => writeJson(EVENTS_FILE, v));
calendarSubscriptions.subscribe((v) => writeJson(SUBS_FILE, v));

export function addEvent(ev: Omit<CalendarEvent, "id">) {
  calendarEvents.set([...calendarEvents.get(), { ...ev, id: uuid() }]);
}
export function updateEvent(id: string, patch: Partial<CalendarEvent>) {
  calendarEvents.set(
    calendarEvents.get().map((e) => (e.id === id ? { ...e, ...patch } : e)),
  );
}
export function deleteEvent(id: string) {
  calendarEvents.set(calendarEvents.get().filter((e) => e.id !== id));
}

// ── ICS sync ──────────────────────────────────────────────────────────────────

function parseICS(raw: string, subId: string, color: string): CalendarEvent[] {
  const unfolded = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "");
  const result: CalendarEvent[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const get = (key: string) => {
      const m = block.match(new RegExp(`^${key}[;:][^\n]*`, "m"));
      return m ? m[0].replace(/^[^:]+:/, "").trim() : "";
    };
    const rawDt = get("DTSTART") || "";
    if (!rawDt) continue;
    const datePart = rawDt.replace(/T.*/, "");
    if (datePart.length < 8) continue;
    const date = `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
    const time =
      rawDt.includes("T") && rawDt.length >= 13
        ? `${rawDt.slice(9, 11)}:${rawDt.slice(11, 13)}`
        : undefined;
    const title = (get("SUMMARY") || "(no title)")
      .replace(/\\n/g, " ")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";");
    const description =
      get("DESCRIPTION").replace(/\\n/g, "\n").replace(/\\,/g, ",") ||
      undefined;
    result.push({
      id: uuid(),
      title,
      date,
      time,
      description,
      color,
      sourceId: subId,
    });
  }
  return result;
}

export function syncSubscription(sub: CalendarSubscription) {
  const url = sub.url.replace(/^webcal:\/\//i, "https://");
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  });
  try {
    const proc = launcher.spawnv(["curl", "-sL", "--max-time", "15", url]);
    proc.communicate_utf8_async(null, null, (_p, res) => {
      try {
        const [, stdout] = proc.communicate_utf8_finish(res);
        if (!stdout?.includes("BEGIN:VCALENDAR")) return;
        const imported = parseICS(stdout, sub.id, sub.color);
        calendarEvents.set([
          ...calendarEvents.get().filter((e) => e.sourceId !== sub.id),
          ...imported,
        ]);
        calendarSubscriptions.set(
          calendarSubscriptions
            .get()
            .map((s) =>
              s.id === sub.id
                ? { ...s, lastSync: new Date().toISOString() }
                : s,
            ),
        );
      } catch (e) {
        console.error("[Calendar] parse error:", e);
      }
    });
  } catch (e) {
    console.error("[Calendar] curl error:", e);
  }
}

export function syncAllSubscriptions() {
  calendarSubscriptions.get().forEach(syncSubscription);
}

syncAllSubscriptions();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30 * 60 * 1000, () => {
  syncAllSubscriptions();
  return true;
});

export function importICSFromFile(
  path: string,
  name: string,
  color: string,
): { count: number; error?: string } {
  try {
    const [ok, raw] = GLib.file_get_contents(path);
    if (!ok) return { count: 0, error: "Could not read file." };
    const text = new TextDecoder().decode(raw);
    if (!text.includes("BEGIN:VCALENDAR"))
      return { count: 0, error: "Not a valid ICS file." };
    const subId = `file:${path}`;
    const imported = parseICS(text, subId, color);
    calendarEvents.set([
      ...calendarEvents.get().filter((e) => e.sourceId !== subId),
      ...imported,
    ]);
    const existing = calendarSubscriptions.get().find((s) => s.id === subId);
    if (!existing) {
      calendarSubscriptions.set([
        ...calendarSubscriptions.get(),
        {
          id: subId,
          name,
          url: `file://${path}`,
          color,
          lastSync: new Date().toISOString(),
        },
      ]);
    } else {
      calendarSubscriptions.set(
        calendarSubscriptions
          .get()
          .map((s) =>
            s.id === subId ? { ...s, lastSync: new Date().toISOString() } : s,
          ),
      );
    }
    return { count: imported.length };
  } catch (e) {
    return { count: 0, error: String(e) };
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function toDateStr(y: number, m: number, d: number) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}
function firstWeekdayMon(y: number, m: number) {
  return (new Date(y, m, 1).getDay() + 6) % 7;
}

// ── Recurring event expansion ─────────────────────────────────────────────────

/**
 * Returns all events (real + virtual recurring instances) that fall on `date`.
 * Virtual instances share the same fields as the master event but with their
 * actual `date` set to the occurrence date. They are NOT persisted.
 */
export function getEventsForDate(
  events: CalendarEvent[],
  date: string,
): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  for (const ev of events) {
    if (ev.date === date) {
      result.push(ev);
      continue;
    }
    if (!ev.recurrence) continue;
    if (ev.date >= date) continue;
    if (ev.recurrenceEnd && date > ev.recurrenceEnd) continue;

    const [sy, sm, sd] = ev.date.split("-").map(Number);
    const [ty, tm, td] = date.split("-").map(Number);

    let matches = false;
    if (ev.recurrence === "daily") {
      matches = true;
    } else if (ev.recurrence === "weekly") {
      const start = new Date(sy, sm - 1, sd);
      const target = new Date(ty, tm - 1, td);
      const diff = Math.round((target.getTime() - start.getTime()) / 86400000);
      matches = diff % 7 === 0;
    } else if (ev.recurrence === "monthly") {
      matches = sd === td;
    } else if (ev.recurrence === "yearly") {
      matches = sm === tm && sd === td;
    }

    if (matches) result.push({ ...ev, date });
  }
  return result;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const COLORS = [
  "#7aa2f7",
  "#9ece6a",
  "#f7768e",
  "#e0af68",
  "#bb9af7",
  "#7dcfff",
  "#ff9e64",
  "#73daca",
];

// ── Colour helpers ────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  let r = parseInt(h.slice(0, 2), 16) / 255;
  let g = parseInt(h.slice(2, 4), 16) / 255;
  let b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let hh = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        hh = ((b - r) / d + 2) / 6;
        break;
      case b:
        hh = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(hh * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const s1 = s / 100,
    l1 = l / 100;
  const a = s1 * Math.min(l1, 1 - l1);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l1 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function setBg(widget: Gtk.Widget, css: string) {
  const p = new Gtk.CssProvider();
  p.load_from_data(css, -1);
  widget
    .get_style_context()
    .add_provider(p, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
}

// ── Custom colour-picker window ───────────────────────────────────────────────

/**
 * Opens a custom colour-picker window that:
 *  - hides `parentDialog` while it is open
 *  - is styled just like the event dialog (same CSS class, same size, centered)
 *  - shows preset swatches, HSL sliders, a live preview, and a hex entry
 *  - calls `onAccept(hex)` and restores `parentDialog` on "Choose"
 *  - calls `onCancel()` and restores `parentDialog` on "Cancel" / close
 */
function openColorPickerWindow(
  parentDialog: Gtk.Window,
  getWin: () => Gtk.Window | null,
  initial: string,
  onAccept: (hex: string) => void,
  onCancel: () => void,
) {
  // Hide the event dialog while the picker is open
  parentDialog.hide();

  let [curH, curS, curL] = hexToHsl(initial);
  let curHex = initial;

  const win = new Gtk.Window({
    title: "Choose Colour",
    defaultWidth: 320,
    resizable: false,
    modal: true,
    transientFor: getWin() ?? undefined,
  });
  win.add_css_class("cal-dialog");

  const restore = (accepted: boolean) => {
    win.close();
    parentDialog.present();
    if (accepted) onAccept(curHex);
    else onCancel();
  };

  // Close button / window-delete also cancels
  win.connect("close-request", () => {
    parentDialog.present();
    onCancel();
    return false;
  });

  const vbox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    marginTop: 16,
    marginBottom: 16,
    marginStart: 16,
    marginEnd: 16,
  });

  const mkLabel = (t: string) =>
    new Gtk.Label({ label: t, xalign: 0, cssClasses: ["cal-dlg-label"] });

  // ── Live preview ──────────────────────────────────────────────────────────
  const previewRow = new Gtk.Box({ spacing: 10 });
  const previewSwatch = new Gtk.Box();
  previewSwatch.set_size_request(40, 40);
  setBg(
    previewSwatch,
    `* { background:${curHex}; border-radius:8px; min-width:40px; min-height:40px;
         border:1px solid alpha(white,0.2); }`,
  );
  const previewHexLbl = new Gtk.Label({
    label: curHex.toUpperCase(),
    xalign: 0,
    cssClasses: ["cal-dlg-label"],
  });
  previewRow.append(previewSwatch);
  previewRow.append(previewHexLbl);

  const syncPreview = () => {
    curHex = hslToHex(curH, curS, curL);
    previewHexLbl.label = curHex.toUpperCase();
    setBg(
      previewSwatch,
      `* { background:${curHex}; border-radius:8px; min-width:40px; min-height:40px;
           border:1px solid alpha(white,0.2); }`,
    );
    hexEntry.text = curHex.toUpperCase();
  };

  // ── Preset swatches ───────────────────────────────────────────────────────
  vbox.append(mkLabel("Presets"));
  const swatchGrid = new Gtk.Box({ spacing: 6, marginBottom: 2 });

  const clearSwatchActive = () => {
    let ch: Gtk.Widget | null = swatchGrid.get_first_child();
    while (ch) {
      ch.remove_css_class("active-swatch");
      ch = ch.get_next_sibling();
    }
  };

  // Extra palette: 16 colours (original 8 + 8 more)
  const FULL_PALETTE = [
    ...COLORS,
    "#f7768e",
    "#ff9e64",
    "#e0af68",
    "#9ece6a",
    "#73daca",
    "#7dcfff",
    "#7aa2f7",
    "#bb9af7",
  ].filter((c, i, a) => a.indexOf(c) === i); // dedupe

  FULL_PALETTE.forEach((c) => {
    const btn = new Gtk.Button();
    btn.set_size_request(26, 26);
    const p = new Gtk.CssProvider();
    p.load_from_data(
      `button { background:${c}; border-radius:50%; padding:0; min-width:26px; min-height:26px;
                border:2px solid transparent; }
       button.active-swatch { border-color:white; box-shadow:0 0 0 1px rgba(0,0,0,0.5); }`,
      -1,
    );
    btn
      .get_style_context()
      .add_provider(p, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    if (c.toLowerCase() === curHex.toLowerCase())
      btn.add_css_class("active-swatch");
    btn.connect("clicked", () => {
      clearSwatchActive();
      btn.add_css_class("active-swatch");
      [curH, curS, curL] = hexToHsl(c);
      curHex = c;
      hSlider.set_value(curH);
      sSlider.set_value(curS);
      lSlider.set_value(curL);
      syncPreview();
    });
    swatchGrid.append(btn);
  });
  vbox.append(swatchGrid);

  // ── HSL sliders ───────────────────────────────────────────────────────────
  const makeSlider = (label: string, min: number, max: number, val: number) => {
    vbox.append(mkLabel(label));
    const sl = new Gtk.Scale({
      orientation: Gtk.Orientation.HORIZONTAL,
      adjustment: new Gtk.Adjustment({
        lower: min,
        upper: max,
        value: val,
        stepIncrement: 1,
        pageIncrement: 10,
      }),
      drawValue: true,
      digits: 0,
      hexpand: true,
    });
    sl.add_css_class("cal-color-slider");
    vbox.append(sl);
    return sl;
  };

  const hSlider = makeSlider("Hue (0–360)", 0, 360, curH);
  const sSlider = makeSlider("Saturation (0–100)", 0, 100, curS);
  const lSlider = makeSlider("Lightness (0–100)", 0, 100, curL);

  // Declare hexEntry before syncPreview uses it
  const hexEntry = new Gtk.Entry({
    text: curHex.toUpperCase(),
    placeholderText: "#RRGGBB",
    maxLength: 7,
    widthChars: 9,
  });

  hSlider.connect("value-changed", () => {
    curH = Math.round(hSlider.get_value());
    clearSwatchActive();
    syncPreview();
  });
  sSlider.connect("value-changed", () => {
    curS = Math.round(sSlider.get_value());
    clearSwatchActive();
    syncPreview();
  });
  lSlider.connect("value-changed", () => {
    curL = Math.round(lSlider.get_value());
    clearSwatchActive();
    syncPreview();
  });

  // ── Hex entry ─────────────────────────────────────────────────────────────
  vbox.append(mkLabel("Hex"));
  const hexRow = new Gtk.Box({ spacing: 8 });
  const applyHexBtn = new Gtk.Button({
    label: "Apply",
    cssClasses: ["cal-dlg-save"],
  });
  applyHexBtn.connect("clicked", () => {
    const val = hexEntry.text.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      curHex = val.toLowerCase();
      [curH, curS, curL] = hexToHsl(curHex);
      hSlider.set_value(curH);
      sSlider.set_value(curS);
      lSlider.set_value(curL);
      clearSwatchActive();
      syncPreview();
    }
  });
  hexEntry.connect("activate", () => applyHexBtn.emit("clicked"));
  hexRow.append(hexEntry);
  hexRow.append(applyHexBtn);
  vbox.append(hexRow);

  // ── Preview + action buttons ──────────────────────────────────────────────
  vbox.append(mkLabel("Preview"));
  vbox.append(previewRow);

  const btnRow = new Gtk.Box({
    spacing: 8,
    halign: Gtk.Align.END,
    marginTop: 4,
  });
  const cancelBtn = new Gtk.Button({ label: "Cancel" });
  const chooseBtn = new Gtk.Button({
    label: "Choose",
    cssClasses: ["cal-dlg-save"],
  });
  cancelBtn.connect("clicked", () => restore(false));
  chooseBtn.connect("clicked", () => restore(true));
  btnRow.append(cancelBtn);
  btnRow.append(chooseBtn);
  vbox.append(btnRow);

  win.set_child(vbox);
  win.present();
}

// ── Colour picker inline widget ───────────────────────────────────────────────

/**
 * Builds the in-dialog colour section: preset swatches + a live preview swatch
 * + a "Custom…" button that swaps to the full colour-picker window.
 */
function makeColorPicker(
  initial: string,
  getParentDialog: () => Gtk.Window,
  getWin: () => Gtk.Window | null,
  onChange: (c: string) => void,
): Gtk.Box {
  let current = initial;

  const outer = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
  });

  // Preview row
  const previewWrap = new Gtk.Box({ spacing: 8 });
  const preview = new Gtk.Box();
  preview.set_size_request(28, 28);
  setBg(
    preview,
    `* { background:${current}; border-radius:6px; min-width:28px; min-height:28px; border:1px solid alpha(white,0.25); }`,
  );
  const previewLbl = new Gtk.Label({
    label: current.toUpperCase(),
    xalign: 0,
    cssClasses: ["cal-dlg-label"],
  });
  previewWrap.append(preview);
  previewWrap.append(previewLbl);

  const refreshPreview = (c: string) => {
    current = c;
    previewLbl.label = c.toUpperCase();
    setBg(
      preview,
      `* { background:${c}; border-radius:6px; min-width:28px; min-height:28px; border:1px solid alpha(white,0.25); }`,
    );
    onChange(c);
  };

  // Preset swatches
  const swatchRow = new Gtk.Box({ spacing: 4, marginBottom: 2 });
  const clearActive = () => {
    let ch: Gtk.Widget | null = swatchRow.get_first_child();
    while (ch) {
      ch.remove_css_class("active-swatch");
      ch = ch.get_next_sibling();
    }
  };
  COLORS.forEach((c) => {
    const btn = new Gtk.Button();
    btn.set_size_request(24, 24);
    const p = new Gtk.CssProvider();
    p.load_from_data(
      `button { background:${c}; border-radius:50%; padding:0; min-width:24px; min-height:24px; border:2px solid transparent; }
       button.active-swatch { border-color:white; box-shadow:0 0 0 1px rgba(0,0,0,0.4); }`,
      -1,
    );
    btn
      .get_style_context()
      .add_provider(p, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    if (c === current) btn.add_css_class("active-swatch");
    btn.connect("clicked", () => {
      clearActive();
      btn.add_css_class("active-swatch");
      refreshPreview(c);
    });
    swatchRow.append(btn);
  });

  // "Custom…" button — opens the full picker window
  const customBtn = new Gtk.Button({
    label: "Custom…",
    cssClasses: ["cal-dlg-label"],
    marginTop: 2,
  });
  customBtn.connect("clicked", () => {
    openColorPickerWindow(
      getParentDialog(),
      getWin,
      current,
      (hex) => {
        clearActive();
        refreshPreview(hex);
      },
      () => {
        /* cancelled — colour unchanged */
      },
    );
  });

  outer.append(previewWrap);
  outer.append(swatchRow);
  outer.append(customBtn);
  return outer;
}

// ── Event edit dialog ─────────────────────────────────────────────────────────

function openEventDialog(
  getWin: () => Gtk.Window | null,
  initialDate: string,
  initialTime?: string,
  existing?: CalendarEvent,
) {
  const dialog = new Gtk.Window({
    title: existing ? "Edit Event" : "New Event",
    defaultWidth: 320,
    resizable: false,
    modal: true,
    transientFor: getWin() ?? undefined,
  });
  dialog.add_css_class("cal-dialog");

  const vbox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    marginTop: 16,
    marginBottom: 16,
    marginStart: 16,
    marginEnd: 16,
  });

  const mkLabel = (t: string) =>
    new Gtk.Label({ label: t, xalign: 0, cssClasses: ["cal-dlg-label"] });

  const titleEntry = new Gtk.Entry({
    placeholderText: "Event title",
    text: existing?.title ?? "",
  });
  const dateEntry = new Gtk.Entry({
    placeholderText: "YYYY-MM-DD",
    text: existing?.date ?? initialDate,
  });
  const timeEntry = new Gtk.Entry({
    placeholderText: "HH:MM  (leave blank = all-day)",
    text: existing?.time ?? initialTime ?? "",
  });
  const descEntry = new Gtk.Entry({
    placeholderText: "Description (optional)",
    text: existing?.description ?? "",
  });

  // ── Recurrence ──────────────────────────────────────────────────────────────
  const RECUR_LABELS = ["None", "Daily", "Weekly", "Monthly", "Yearly"];
  const RECUR_VALUES: (RecurrenceFreq | undefined)[] = [
    undefined,
    "daily",
    "weekly",
    "monthly",
    "yearly",
  ];

  const recurStore = Gtk.StringList.new(RECUR_LABELS);
  const recurDrop = new Gtk.DropDown({
    model: recurStore,
    selected: RECUR_VALUES.indexOf(existing?.recurrence),
  });

  const recurEndEntry = new Gtk.Entry({
    placeholderText: "End date YYYY-MM-DD (optional)",
    text: existing?.recurrenceEnd ?? "",
    sensitive: !!existing?.recurrence,
  });

  recurDrop.connect("notify::selected", () => {
    const idx = recurDrop.selected;
    recurEndEntry.sensitive = idx > 0;
    if (idx === 0) recurEndEntry.text = "";
  });

  let color = existing?.color ?? COLORS[0];
  const colorPicker = makeColorPicker(
    color,
    () => dialog,
    getWin,
    (c) => {
      color = c;
    },
  );

  const btnRow = new Gtk.Box({
    spacing: 8,
    halign: Gtk.Align.END,
    marginTop: 4,
  });

  if (existing) {
    const del = new Gtk.Button({
      label: "Delete",
      cssClasses: ["cal-dlg-danger"],
    });
    del.connect("clicked", () => {
      deleteEvent(existing.id);
      dialog.close();
    });
    btnRow.append(del);
  }

  const cancel = new Gtk.Button({ label: "Cancel" });
  cancel.connect("clicked", () => dialog.close());

  const save = new Gtk.Button({
    label: existing ? "Save" : "Add",
    cssClasses: ["cal-dlg-save"],
  });
  save.connect("clicked", () => {
    const title = titleEntry.text.trim();
    const date = dateEntry.text.trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const time = timeEntry.text.trim() || undefined;
    const description = descEntry.text.trim() || undefined;
    const recurrence = RECUR_VALUES[recurDrop.selected];
    const recurrenceEnd =
      recurrence && /^\d{4}-\d{2}-\d{2}$/.test(recurEndEntry.text.trim())
        ? recurEndEntry.text.trim()
        : undefined;
    if (existing)
      updateEvent(existing.id, {
        title,
        date,
        time,
        description,
        color,
        recurrence,
        recurrenceEnd,
      });
    else
      addEvent({
        title,
        date,
        time,
        description,
        color,
        recurrence,
        recurrenceEnd,
      });
    dialog.close();
  });

  btnRow.append(cancel);
  btnRow.append(save);

  [
    mkLabel("Title"),
    titleEntry,
    mkLabel("Date"),
    dateEntry,
    mkLabel("Time (optional)"),
    timeEntry,
    mkLabel("Description (optional)"),
    descEntry,
    mkLabel("Repeat"),
    recurDrop,
    mkLabel("Repeat ends (optional)"),
    recurEndEntry,
    mkLabel("Colour"),
    colorPicker,
    btnRow,
  ].forEach((w) => vbox.append(w));

  dialog.set_child(vbox);
  dialog.present();
}

// ── Day view (inline sidebar page) ───────────────────────────────────────────
// Called by RightSidebar to build the day-view page content for the stack.
// Returns a widget + an update function so the sidebar can refresh it when
// navigating to a new date.

export function buildDayView(
  getWin: () => Gtk.Window | null,
  date: string,
  onBack: () => void,
): Gtk.Widget {
  const [y, mo, d] = date.split("-").map(Number);
  const heading = `${d} ${MONTHS[mo - 1]} ${y}`;

  const pad2_ = (n: number) => n.toString().padStart(2, "0");

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    vexpand: true,
  });
  root.add_css_class("dv-root");

  // ── Header ─────────────────────────────────────────────────────────────────
  const hdr = new Gtk.Box({ spacing: 8, cssClasses: ["dv-header"] });

  const backBtn = new Gtk.Button({
    iconName: "go-previous-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  backBtn.connect("clicked", onBack);

  const titleLbl = new Gtk.Label({
    label: heading,
    hexpand: true,
    xalign: 0,
    cssClasses: ["dv-title"],
  });

  const addBtn = new Gtk.Button({
    iconName: "list-add-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  addBtn.set_tooltip_text("Add event");
  addBtn.connect("clicked", () => openEventDialog(getWin, date));

  hdr.append(backBtn);
  hdr.append(titleLbl);
  hdr.append(addBtn);
  root.append(hdr);

  // ── Scrollable hour grid ───────────────────────────────────────────────────
  const scroll = new Gtk.ScrolledWindow({
    vexpand: true,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
  });

  const renderContent = () => {
    const evs = getEventsForDate(calendarEvents.get(), date);

    const container = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });

    // All-day strip
    const allDay = evs.filter((e) => !e.time);
    if (allDay.length) {
      const strip = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        cssClasses: ["dv-allday-strip"],
      });
      strip.append(
        new Gtk.Label({
          label: "All day",
          xalign: 0,
          cssClasses: ["dv-allday-label"],
        }),
      );
      allDay.forEach((ev) => {
        const row = new Gtk.Box({ spacing: 6, cssClasses: ["dv-allday-row"] });
        const dot = new Gtk.Box();
        dot.set_size_request(8, 8);
        dot.set_valign(Gtk.Align.CENTER);
        const dp = new Gtk.CssProvider();
        dp.load_from_data(
          `* { background:${ev.color ?? "#7aa2f7"}; border-radius:50%; min-width:8px; min-height:8px; }`,
          -1,
        );
        dot
          .get_style_context()
          .add_provider(dp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        const tl = new Gtk.Label({
          label: ev.title,
          xalign: 0,
          hexpand: true,
          cssClasses: ["dv-allday-title"],
        });
        tl.set_ellipsize(3);
        row.append(dot);
        row.append(tl);
        if (!ev.sourceId) {
          const edit = new Gtk.Button({
            iconName: "document-edit-symbolic",
            cssClasses: ["cal-icon-btn"],
          });
          edit.connect("clicked", () =>
            openEventDialog(getWin, date, undefined, ev),
          );
          row.append(edit);
        }
        strip.append(row);
      });
      container.append(strip);
      container.append(
        new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }),
      );
    }

    // Hour grid
    const hourGrid = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      cssClasses: ["dv-hour-grid"],
    });

    const byHour = new Map<number, CalendarEvent[]>();
    evs
      .filter((e) => e.time)
      .forEach((ev) => {
        const h = parseInt(ev.time!.split(":")[0], 10);
        if (!byHour.has(h)) byHour.set(h, []);
        byHour.get(h)!.push(ev);
      });

    const nowDt = GLib.DateTime.new_now_local();
    const todayStr = toDateStr(
      nowDt.get_year(),
      nowDt.get_month() - 1,
      nowDt.get_day_of_month(),
    );
    const isToday = date === todayStr;
    const currentHour = nowDt.get_hour();

    for (let h = 0; h < 24; h++) {
      const slot = new Gtk.Box({ spacing: 0, cssClasses: ["dv-slot"] });
      if (isToday && h === currentHour) slot.add_css_class("dv-slot-now");

      const timeLbl = new Gtk.Label({
        label: `${pad2_(h)}:00`,
        valign: Gtk.Align.START,
        cssClasses: ["dv-time-lbl"],
        widthRequest: 44,
      });
      slot.append(timeLbl);
      slot.append(
        new Gtk.Separator({
          orientation: Gtk.Orientation.VERTICAL,
          cssClasses: ["dv-vdiv"],
        }),
      );

      const evCol = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 3,
        hexpand: true,
        cssClasses: ["dv-ev-col"],
      });

      (byHour.get(h) ?? []).forEach((ev) => {
        const card = new Gtk.Box({ spacing: 6, cssClasses: ["dv-ev-card"] });

        const bar = new Gtk.Box();
        bar.set_size_request(3, -1);
        bar.set_vexpand(true);
        const bp = new Gtk.CssProvider();
        bp.load_from_data(
          `* { background:${ev.color ?? "#7aa2f7"}; border-radius:2px; min-width:3px; }`,
          -1,
        );
        bar
          .get_style_context()
          .add_provider(bp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        const info = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          hexpand: true,
          spacing: 1,
        });
        const tl = new Gtk.Label({
          label: ev.title,
          xalign: 0,
          cssClasses: ["dv-ev-title"],
        });
        tl.set_ellipsize(3);
        info.append(tl);
        if (ev.recurrence) {
          const badge = new Gtk.Label({
            label: `↺ ${ev.recurrence}`,
            xalign: 0,
            cssClasses: ["dv-ev-recur"],
          });
          info.append(badge);
        }
        if (ev.time)
          info.append(
            new Gtk.Label({
              label: ev.time,
              xalign: 0,
              cssClasses: ["dv-ev-time"],
            }),
          );
        if (ev.description) {
          const dl = new Gtk.Label({
            label: ev.description,
            xalign: 0,
            wrap: true,
            cssClasses: ["dv-ev-desc"],
          });
          info.append(dl);
        }

        card.append(bar);
        card.append(info);
        if (!ev.sourceId) {
          const edit = new Gtk.Button({
            iconName: "document-edit-symbolic",
            cssClasses: ["cal-icon-btn"],
          });
          edit.connect("clicked", () =>
            openEventDialog(getWin, date, ev.time, ev),
          );
          card.append(edit);
        }
        evCol.append(card);
      });

      // Double-click slot → add event at that hour
      const gc = new Gtk.GestureClick();
      gc.connect("pressed", (_g, n) => {
        if (n === 2) openEventDialog(getWin, date, `${pad2_(h)}:00`);
      });
      slot.add_controller(gc);

      slot.append(evCol);
      hourGrid.append(slot);
      if (h < 23)
        hourGrid.append(
          new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
            cssClasses: ["dv-half-line"],
          }),
        );
    }

    container.append(hourGrid);
    return container;
  };

  scroll.set_child(renderContent());

  // Live-update when events change
  const unsub = calendarEvents.subscribe(() => {
    scroll.set_child(renderContent());
  });
  root.connect("destroy", unsub);

  root.append(scroll);

  // Scroll to current hour (or 08:00)
  const nowDt2 = GLib.DateTime.new_now_local();
  const todayStr2 = toDateStr(
    nowDt2.get_year(),
    nowDt2.get_month() - 1,
    nowDt2.get_day_of_month(),
  );
  const scrollTo = date === todayStr2 ? nowDt2.get_hour() : 8;
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    const adj = scroll.get_vadjustment();
    adj.set_value(Math.max(0, scrollTo * 48 - 96));
    return false;
  });

  return root;
}

// ── Subscription dialog ───────────────────────────────────────────────────────

function openSubscriptionDialog(getWin: () => Gtk.Window | null) {
  const dialog = new Gtk.Window({
    title: "Add Calendar",
    defaultWidth: 360,
    resizable: false,
    modal: true,
    transientFor: getWin() ?? undefined,
  });
  dialog.add_css_class("cal-dialog");

  const outer = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    marginTop: 16,
    marginBottom: 16,
    marginStart: 16,
    marginEnd: 16,
  });

  const mkLabel = (t: string) =>
    new Gtk.Label({ label: t, xalign: 0, cssClasses: ["cal-dlg-label"] });

  const tabRow = new Gtk.Box({
    spacing: 0,
    cssClasses: ["cal-tab-row"],
    marginBottom: 12,
  });
  const tabUrl = new Gtk.Button({
    label: "From URL",
    cssClasses: ["cal-tab", "cal-tab-active"],
  });
  const tabFile = new Gtk.Button({
    label: "From File",
    cssClasses: ["cal-tab"],
  });
  tabUrl.set_hexpand(true);
  tabFile.set_hexpand(true);
  tabRow.append(tabUrl);
  tabRow.append(tabFile);
  outer.append(tabRow);

  const nameEntry = new Gtk.Entry({ placeholderText: "Calendar name" });
  let color = COLORS[4];
  const swatches = makeSwatchRow(color, (c) => {
    color = c;
  });
  const status = new Gtk.Label({
    label: "",
    xalign: 0,
    cssClasses: ["cal-dlg-status"],
  });

  const urlPanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
  });
  const urlEntry = new Gtk.Entry({
    placeholderText: "https:// or webcal:// ICS URL",
  });
  const urlBtnRow = new Gtk.Box({ spacing: 8, halign: Gtk.Align.END });
  const urlCancel = new Gtk.Button({ label: "Cancel" });
  urlCancel.connect("clicked", () => dialog.close());
  const urlAdd = new Gtk.Button({
    label: "Subscribe & Sync",
    cssClasses: ["cal-dlg-save"],
  });
  urlAdd.connect("clicked", () => {
    const name = nameEntry.text.trim(),
      url = urlEntry.text.trim();
    if (!name || !url) {
      status.label = "Name and URL required.";
      return;
    }
    if (!/^https?:\/\/|^webcal:\/\//i.test(url)) {
      status.label = "URL must start with https://, http://, or webcal://";
      return;
    }
    const sub: CalendarSubscription = { id: uuid(), name, url, color };
    calendarSubscriptions.set([...calendarSubscriptions.get(), sub]);
    status.label = "Syncing…";
    urlAdd.set_sensitive(false);
    syncSubscription(sub);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      dialog.close();
      return false;
    });
  });
  urlBtnRow.append(urlCancel);
  urlBtnRow.append(urlAdd);
  [mkLabel("ICS URL"), urlEntry].forEach((w) => urlPanel.append(w));

  const filePanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
  });
  filePanel.set_visible(false);
  const filePathLbl = new Gtk.Label({
    label: "No file selected",
    xalign: 0,
    cssClasses: ["cal-dlg-status"],
    wrap: true,
  });
  const browseBtn = new Gtk.Button({
    label: "Browse for .ics file…",
    cssClasses: ["cal-browse-btn"],
  });
  let selectedPath = "";
  browseBtn.connect("clicked", () => {
    const fc = new Gtk.FileChooserDialog({
      title: "Select ICS File",
      action: Gtk.FileChooserAction.OPEN,
      transientFor: dialog,
      modal: true,
    });
    fc.add_button("Cancel", Gtk.ResponseType.CANCEL);
    fc.add_button("Open", Gtk.ResponseType.ACCEPT);
    const filter = new Gtk.FileFilter();
    filter.set_name("iCalendar files (*.ics)");
    filter.add_pattern("*.ics");
    filter.add_mime_type("text/calendar");
    fc.add_filter(filter);
    fc.connect("response", (_self, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        const file = fc.get_file();
        if (file) {
          selectedPath = file.get_path() ?? "";
          const base = selectedPath.split("/").pop() ?? selectedPath;
          filePathLbl.label = base;
          if (!nameEntry.text.trim())
            nameEntry.set_text(base.replace(/\.ics$/i, ""));
        }
      }
      fc.close();
    });
    fc.present();
  });
  const fileBtnRow = new Gtk.Box({ spacing: 8, halign: Gtk.Align.END });
  const fileCancel = new Gtk.Button({ label: "Cancel" });
  fileCancel.connect("clicked", () => dialog.close());
  const fileImport = new Gtk.Button({
    label: "Import",
    cssClasses: ["cal-dlg-save"],
  });
  fileImport.connect("clicked", () => {
    const name = nameEntry.text.trim();
    if (!name) {
      status.label = "Calendar name required.";
      return;
    }
    if (!selectedPath) {
      status.label = "Please select a .ics file.";
      return;
    }
    const result = importICSFromFile(selectedPath, name, color);
    if (result.error) {
      status.label = `Error: ${result.error}`;
    } else {
      status.label = `Imported ${result.count} event${result.count !== 1 ? "s" : ""}.`;
      fileImport.set_sensitive(false);
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        dialog.close();
        return false;
      });
    }
  });
  fileBtnRow.append(fileCancel);
  fileBtnRow.append(fileImport);
  [mkLabel("ICS File"), browseBtn, filePathLbl].forEach((w) =>
    filePanel.append(w),
  );

  const shared = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
  });
  [mkLabel("Name"), nameEntry, mkLabel("Colour"), swatches].forEach((w) =>
    shared.append(w),
  );

  const switchTab = (toFile: boolean) => {
    urlPanel.set_visible(!toFile);
    filePanel.set_visible(toFile);
    if (toFile) {
      tabFile.add_css_class("cal-tab-active");
      tabUrl.remove_css_class("cal-tab-active");
      if (urlBtnRow.get_parent()) outer.remove(urlBtnRow);
      outer.append(fileBtnRow);
    } else {
      tabUrl.add_css_class("cal-tab-active");
      tabFile.remove_css_class("cal-tab-active");
      if (fileBtnRow.get_parent()) outer.remove(fileBtnRow);
      outer.append(urlBtnRow);
    }
    status.label = "";
  };
  tabUrl.connect("clicked", () => switchTab(false));
  tabFile.connect("clicked", () => switchTab(true));

  [shared, urlPanel, filePanel, status, urlBtnRow].forEach((w) =>
    outer.append(w),
  );
  dialog.set_child(outer);
  dialog.present();
}

// ── Subscriptions list panel ──────────────────────────────────────────────────

function SubscriptionsList(): Gtk.Widget {
  const outer = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
  });
  const render = (subs: CalendarSubscription[]) => {
    let ch = outer.get_first_child();
    while (ch) {
      const n = ch.get_next_sibling();
      outer.remove(ch);
      ch = n;
    }
    if (!subs.length) {
      outer.append(
        new Gtk.Label({
          label: "No subscriptions",
          xalign: 0,
          cssClasses: ["cal-empty"],
        }),
      );
      return;
    }
    subs.forEach((sub) => {
      const row = new Gtk.Box({ spacing: 8, cssClasses: ["cal-sub-row"] });
      const dot = new Gtk.Box();
      dot.set_size_request(10, 10);
      dot.set_valign(Gtk.Align.CENTER);
      const dp = new Gtk.CssProvider();
      dp.load_from_data(
        `* { background:${sub.color}; border-radius:50%; min-width:10px; min-height:10px; }`,
        -1,
      );
      dot
        .get_style_context()
        .add_provider(dp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
      const lbl = new Gtk.Label({ label: sub.name, xalign: 0, hexpand: true });
      lbl.set_ellipsize(3);
      const syncBtn = new Gtk.Button({
        iconName: "view-refresh-symbolic",
        cssClasses: ["cal-icon-btn"],
      });
      syncBtn.set_tooltip_text("Sync now");
      syncBtn.connect("clicked", () => syncSubscription(sub));
      const delBtn = new Gtk.Button({
        iconName: "edit-delete-symbolic",
        cssClasses: ["cal-icon-btn", "cal-danger"],
      });
      delBtn.set_tooltip_text("Remove");
      delBtn.connect("clicked", () => {
        calendarSubscriptions.set(
          calendarSubscriptions.get().filter((s) => s.id !== sub.id),
        );
        calendarEvents.set(
          calendarEvents.get().filter((e) => e.sourceId !== sub.id),
        );
      });
      row.append(dot);
      row.append(lbl);
      row.append(syncBtn);
      row.append(delBtn);
      outer.append(row);
    });
  };
  const unsub = calendarSubscriptions.subscribe(render);
  outer.connect("destroy", unsub);
  return outer;
}

// ── Main Calendar widget ──────────────────────────────────────────────────────

export default function CalendarWidget(
  getWin: () => Gtk.Window | null,
  onDayClick: (date: string) => void,
): Gtk.Widget {
  const now = GLib.DateTime.new_now_local();
  const today = toDateStr(
    now.get_year(),
    now.get_month() - 1,
    now.get_day_of_month(),
  );

  const viewYear = new Variable(now.get_year());
  const viewMonth = new Variable(now.get_month() - 1);
  const selDate = new Variable(today);

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
  });
  root.add_css_class("cal-widget");

  // Nav row
  const navRow = new Gtk.Box({ spacing: 4, cssClasses: ["cal-nav"] });
  const prevBtn = new Gtk.Button({
    iconName: "go-previous-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  const nextBtn = new Gtk.Button({
    iconName: "go-next-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  const monthLbl = new Gtk.Label({
    hexpand: true,
    xalign: 0.5,
    cssClasses: ["cal-month-lbl"],
  });
  const todayBtn = new Gtk.Button({
    label: "Today",
    cssClasses: ["cal-today-btn"],
  });
  const subBtn = new Gtk.Button({
    iconName: "list-add-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  subBtn.set_tooltip_text("Add ICS subscription / file");
  const syncBtn = new Gtk.Button({
    iconName: "view-refresh-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  syncBtn.set_tooltip_text("Sync all subscriptions");
  navRow.append(prevBtn);
  navRow.append(monthLbl);
  navRow.append(nextBtn);
  navRow.append(todayBtn);
  navRow.append(syncBtn);
  navRow.append(subBtn);
  root.append(navRow);

  // Day-of-week header
  const dowRow = new Gtk.Box({ cssClasses: ["cal-dow-row"] });
  DAYS.forEach((d) =>
    dowRow.append(
      new Gtk.Label({ label: d, hexpand: true, cssClasses: ["cal-dow"] }),
    ),
  );
  root.append(dowRow);

  // Grid
  const grid = new Gtk.Grid({
    columnSpacing: 2,
    rowSpacing: 2,
    cssClasses: ["cal-grid"],
  });
  root.append(grid);

  root.append(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }));

  // Mini event list (compact, below grid — just a summary teaser)
  const miniList = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    cssClasses: ["cal-event-list"],
  });
  root.append(miniList);

  // Subscriptions
  const subHeader = new Gtk.Box({
    spacing: 8,
    cssClasses: ["cal-sub-header"],
    marginTop: 4,
  });
  const subTitle = new Gtk.Label({
    label: "Subscriptions",
    xalign: 0,
    hexpand: true,
    cssClasses: ["cal-section-title"],
  });
  const subToggle = new Gtk.Button({
    iconName: "go-down-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  subHeader.append(subTitle);
  subHeader.append(subToggle);
  root.append(subHeader);
  const subRevealer = new Gtk.Revealer({
    transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
    revealChild: false,
    child: SubscriptionsList(),
  });
  root.append(subRevealer);
  let subsOpen = false;
  subToggle.connect("clicked", () => {
    subsOpen = !subsOpen;
    subRevealer.reveal_child = subsOpen;
    subToggle.set_icon_name(subsOpen ? "go-up-symbolic" : "go-down-symbolic");
  });

  // Grid render
  const renderGrid = () => {
    const y = viewYear.get(),
      m = viewMonth.get();
    monthLbl.label = `${MONTHS[m]} ${y}`;
    let ch: Gtk.Widget | null = grid.get_first_child();
    while (ch) {
      const n = ch.get_next_sibling();
      grid.remove(ch);
      ch = n;
    }

    const days = daysInMonth(y, m),
      offset = firstWeekdayMon(y, m);
    const events = calendarEvents.get(),
      sel = selDate.get();

    for (let i = 0; i < offset; i++) {
      const b = new Gtk.Box();
      b.add_css_class("cal-cell-blank");
      grid.attach(b, i, 0, 1, 1);
    }

    let col = offset,
      row = 0;
    for (let dd = 1; dd <= days; dd++) {
      const ds = toDateStr(y, m, dd);
      const dayEvs = getEventsForDate(events, ds);

      const cell = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        halign: Gtk.Align.CENTER,
      });
      cell.add_css_class("cal-cell");
      if (ds === today) cell.add_css_class("cal-today");
      if (ds === sel) cell.add_css_class("cal-sel");

      cell.append(
        new Gtk.Label({ label: String(dd), cssClasses: ["cal-day-num"] }),
      );

      if (dayEvs.length) {
        const dots = new Gtk.Box({ halign: Gtk.Align.CENTER, spacing: 2 });
        dayEvs.slice(0, 3).forEach((ev) => {
          const dot = new Gtk.Box();
          dot.set_size_request(5, 5);
          const p = new Gtk.CssProvider();
          p.load_from_data(
            `* { background:${ev.color ?? "#7aa2f7"}; border-radius:50%; min-width:5px; min-height:5px; }`,
            -1,
          );
          dot
            .get_style_context()
            .add_provider(p, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
          dots.append(dot);
        });
        cell.append(dots);
      }

      const gc = new Gtk.GestureClick();
      gc.connect("pressed", (_g, n) => {
        selDate.set(ds);
        if (n === 1) {
          onDayClick(ds);
        } else if (n === 2) {
          openEventDialog(getWin, ds);
        }
      });
      cell.add_controller(gc);

      grid.attach(cell, col, row, 1, 1);
      col++;
      if (col > 6) {
        col = 0;
        row++;
      }
    }
  };

  // Mini list under grid — just shows count + first event as a teaser
  const renderMiniList = () => {
    const date = selDate.get();
    let ch: Gtk.Widget | null = miniList.get_first_child();
    while (ch) {
      const n = ch.get_next_sibling();
      miniList.remove(ch);
      ch = n;
    }

    const [y, mo, dd] = date.split("-").map(Number);
    const hdr = new Gtk.Box({ spacing: 8 });
    const heading = new Gtk.Label({
      label: `${dd} ${MONTHS[mo - 1]} ${y}`,
      xalign: 0,
      hexpand: true,
      cssClasses: ["cal-day-heading"],
    });
    const openBtn = new Gtk.Button({
      label: "Open day view",
      cssClasses: ["cal-open-day-btn"],
    });
    openBtn.connect("clicked", () => onDayClick(date));
    hdr.append(heading);
    hdr.append(openBtn);
    miniList.append(hdr);

    const evs = getEventsForDate(calendarEvents.get(), date).sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return -1;
      if (!b.time) return 1;
      return a.time!.localeCompare(b.time!);
    });

    if (!evs.length) {
      miniList.append(
        new Gtk.Label({
          label: "No events — click to open day view, double-click to add",
          xalign: 0,
          cssClasses: ["cal-empty"],
        }),
      );
      return;
    }

    // Show up to 3 events as compact chips
    evs.slice(0, 3).forEach((ev) => {
      const chip = new Gtk.Box({ spacing: 6, cssClasses: ["cal-ev-chip"] });
      const dot = new Gtk.Box();
      dot.set_size_request(8, 8);
      dot.set_valign(Gtk.Align.CENTER);
      const dp = new Gtk.CssProvider();
      dp.load_from_data(
        `* { background:${ev.color ?? "#7aa2f7"}; border-radius:50%; min-width:8px; min-height:8px; }`,
        -1,
      );
      dot
        .get_style_context()
        .add_provider(dp, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
      const tl = new Gtk.Label({
        label: ev.time ? `${ev.time}  ${ev.title}` : ev.title,
        xalign: 0,
        hexpand: true,
      });
      tl.set_ellipsize(3);
      tl.add_css_class("cal-ev-chip-label");
      chip.append(dot);
      chip.append(tl);
      miniList.append(chip);
    });

    if (evs.length > 3) {
      miniList.append(
        new Gtk.Label({
          label: `+${evs.length - 3} more — open day view`,
          xalign: 0,
          cssClasses: ["cal-empty"],
        }),
      );
    }
  };

  const u1 = viewYear.subscribe(renderGrid);
  const u2 = viewMonth.subscribe(() => renderGrid());
  const u3 = calendarEvents.subscribe(() => {
    renderGrid();
    renderMiniList();
  });
  const u4 = selDate.subscribe(renderMiniList);
  root.connect("destroy", () => {
    u1();
    u2();
    u3();
    u4();
  });

  prevBtn.connect("clicked", () => {
    let m = viewMonth.get() - 1,
      y = viewYear.get();
    if (m < 0) {
      m = 11;
      y--;
    }
    viewMonth.set(m);
    viewYear.set(y);
  });
  nextBtn.connect("clicked", () => {
    let m = viewMonth.get() + 1,
      y = viewYear.get();
    if (m > 11) {
      m = 0;
      y++;
    }
    viewMonth.set(m);
    viewYear.set(y);
  });
  todayBtn.connect("clicked", () => {
    viewYear.set(now.get_year());
    viewMonth.set(now.get_month() - 1);
    selDate.set(today);
  });
  syncBtn.connect("clicked", syncAllSubscriptions);
  subBtn.connect("clicked", () => openSubscriptionDialog(getWin));

  return root;
}
