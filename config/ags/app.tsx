#!/usr/bin/env -S ags run
import { createBinding, For, This } from "ags";
import app from "ags/gtk4/app";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";

// Imports from your local directory
import Bar from "./Bar";
import VolumePopup from "./Widgets/VolumePopup";
import SettingsWindow from "./Widgets/Settings";
import Applauncher from "./Widgets/Applauncher";
import NotificationCenter from "./Widgets/Notification";
import NotificationPopups from "./Widgets/Notificationpopup";

const configDir = `${GLib.get_user_config_dir()}/ags`;
const STYLE_PATH = `${configDir}/style.css`;
const MATUGEN_DIR = `${GLib.get_home_dir()}/.cache/matugen`;

// Keep these alive so the Garbage Collector doesn't break them
let applauncherWin: Gtk.Window;
let fileMonitor: Gio.FileMonitor;
let debounceTimerId: number = 0;

app.start({
  instanceName: "shell", // This allows 'ags -i shell run toggle'
  css: STYLE_PATH,

  // This handles the toggle request from your keybinds
  requestHandler(argv, res) {
    if (argv[0] === "toggle") {
      if (applauncherWin) {
        applauncherWin.visible = !applauncherWin.visible;
        if (applauncherWin.visible) applauncherWin.present();
        return res("ok");
      }
      return res("launcher not initialized");
    }
    return res("unknown command");
  },

  main() {
    // Disable GTK Inspector
    const settings = Gtk.Settings.get_default();
    if (settings) {
      settings.gtk_enable_inspector_keybinding = false;
    }

    // 1. Create the Launcher (only once, not per monitor)
    applauncherWin = Applauncher() as Gtk.Window;
    // Force it to be hidden BEFORE adding to app
    applauncherWin.visible = false;
    applauncherWin.hide();
    app.add_window(applauncherWin);

    // 2. Setup the CSS monitor for Matugen
    const dir = Gio.File.new_for_path(MATUGEN_DIR);
    try {
      fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      fileMonitor.connect("changed", (_self, file) => {
        if (file.get_basename() !== "colors.css") return;

        if (debounceTimerId > 0) GLib.source_remove(debounceTimerId);
        debounceTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          app.apply_css(STYLE_PATH);
          debounceTimerId = 0;
          return false;
        });
      });
    } catch (e) {
      console.error(e);
    }

    // 3. Setup Bar and Settings for every monitor
    const monitors = createBinding(app, "monitors");
    return (
      <For each={monitors}>
        {(gdkmonitor) => (
          <This this={app}>
            <Bar gdkmonitor={gdkmonitor} />
            <SettingsWindow gdkmonitor={gdkmonitor} />
            <VolumePopup gdkmonitor={gdkmonitor} />
            <NotificationCenter gdkmonitor={gdkmonitor} />
            <NotificationPopups />
          </This>
        )}
      </For>
    );
  },
});
