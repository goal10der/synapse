import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { Variable } from "./utils/Variable";

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
const CONFIG_PATH = `${GLib.get_user_config_dir()}/ags/bar-layout.json`;

export function toggleEditMode(): void {
  editMode.set(!editMode.get());
}

export function saveBarConfig(config: BarConfig): void {
  barConfig.set(config);
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
  } catch (e) {
    console.error("Failed to save bar config:", e);
  }
}

export function loadBarConfig(): BarConfig {
  try {
    const file = Gio.File.new_for_path(CONFIG_PATH);

    if (!file.query_exists(null)) {
      return defaultConfig;
    }

    const [, contents] = file.load_contents(null);
    const decoder = new TextDecoder();
    const config = JSON.parse(decoder.decode(contents)) as BarConfig;
    barConfig.set(config);
    return config;
  } catch (e) {
    console.error("Failed to load bar config:", e);
    return defaultConfig;
  }
}
