// State.ts
import Gio from "gi://Gio";
import GLib from "gi://GLib";

// Custom Variable class
class Variable<T> {
  private value: T;
  private listeners: Set<(value: T) => void> = new Set();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  set(newValue: T): void {
    if (this.value !== newValue) {
      this.value = newValue;
      this.notify();
    }
  }

  subscribe(callback: (value: T) => void): () => void {
    this.listeners.add(callback);
    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.value));
  }
}

export type WidgetType =
  | "clock"
  | "settings"
  | "workspaces"
  | "tray"
  | "sidebar"
  | "notifications"
  | "battery";

export interface BarConfig {
  left: WidgetType[];
  center: WidgetType[];
  right: WidgetType[];
}

const defaultConfig: BarConfig = {
  left: ["clock", "settings"],
  center: ["workspaces"],
  right: ["tray", "sidebar", "battery"],
};

export const barConfig = new Variable<BarConfig>(defaultConfig);
export const editMode = new Variable<boolean>(false);

// Better config path - use ~/.config/ags/bar-layout.json
const CONFIG_PATH = `${GLib.get_user_config_dir()}/ags/bar-layout.json`;

export function toggleEditMode() {
  editMode.set(!editMode.get());
}

export function saveBarConfig(config: BarConfig) {
  barConfig.set(config);
  // Save to file
  try {
    const file = Gio.File.new_for_path(CONFIG_PATH);
    const contents = JSON.stringify(config, null, 2);
    const bytes = new TextEncoder().encode(contents);

    file.replace_contents(
      bytes,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    );
    console.log(`Bar config saved to ${CONFIG_PATH}`);
  } catch (e) {
    console.error("Failed to save bar config:", e);
  }
}

export function loadBarConfig(): BarConfig {
  try {
    const file = Gio.File.new_for_path(CONFIG_PATH);

    if (!file.query_exists(null)) {
      console.log("No bar config found, using default");
      return defaultConfig;
    }

    const [, contents] = file.load_contents(null);
    const decoder = new TextDecoder();
    const config = JSON.parse(decoder.decode(contents)) as BarConfig;
    barConfig.set(config);
    console.log(`Bar config loaded from ${CONFIG_PATH}`);
    return config;
  } catch (e) {
    console.error("Failed to load bar config:", e);
    return defaultConfig;
  }
}
