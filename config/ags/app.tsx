#!/usr/bin/env -S ags run
import { createBinding, For, This } from "ags";
import app from "ags/gtk4/app";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import Bar from "./Bar";
import VolumePopup from "./Widgets/VolumePopup";
import SettingsWindow from "./Widgets/Settings";
import Applauncher from "./Widgets/Applauncher";
import NotificationPopups from "./Widgets/Notificationpopup";
import Sidebar from "./Widgets/RightSidebar";
import PowerMenu from "./Widgets/PowerMenu";
import MusicPopup from "./Widgets/BottomPopup";
import { toggleEditMode, editMode } from "./State";

const configDir = `${GLib.get_user_config_dir()}/ags`;
const STYLE_PATH = `${configDir}/style.css`;
const MATUGEN_DIR = `${GLib.get_home_dir()}/.cache/matugen`;
app.start({
  instanceName: "shell",
  css: STYLE_PATH,
  requestHandler(argv, res) {
    if (argv[0] === "toggle") {
      const _app: any = app;
      if (_app.applauncherWin) {
        _app.applauncherWin.visible = !_app.applauncherWin.visible;
        if (_app.applauncherWin.visible) _app.applauncherWin.present();
        return res("ok");
      }
      return res("launcher not initialized");
    }
    if (argv[0] === "RightSidebar") {
      const monitors = app.get_monitors();
      if (monitors.length > 0) {
        const connector = monitors[0].connector;
        app.toggle_window(`RightSidebar-${connector}`);
        return res("ok");
      }
      return res("no monitors found");
    }
    if (argv[0] === "toggle-powermenu") {
      const monitors = app.get_monitors();
      monitors.forEach((m) => app.toggle_window(`powermenu-${m.connector}`));
      return res("ok");
    }
    if (argv[0] === "toggle-edit-mode") {
      toggleEditMode();
      return res(
        `ok - edit mode is now ${editMode.get() ? "enabled" : "disabled"}`,
      );
    }
    if (argv[0] === "music-popup") {
      const monitors = app.get_monitors();
      monitors.forEach((m) => app.toggle_window(`music-popup-${m.connector}`));
      return res("ok");
    }

    return res("unknown command");
  },
  main() {
    const _app: any = app;
    _app.applauncherWin = Applauncher() as Gtk.Window;
    _app.applauncherWin.visible = false;
    _app.applauncherWin.hide();
    app.add_window(_app.applauncherWin);
    const dir = Gio.File.new_for_path(MATUGEN_DIR);
    try {
      _app.fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
      _app.fileMonitor.connect("changed", (_self, file) => {
        if (file.get_basename() !== "colors.css") return;
        if ((_app.debounceTimerId ?? 0) > 0)
          GLib.source_remove(_app.debounceTimerId);
        _app.debounceTimerId = GLib.timeout_add(
          GLib.PRIORITY_DEFAULT,
          300,
          () => {
            app.apply_css(STYLE_PATH);
            _app.debounceTimerId = 0;
            return false;
          },
        );
      });
    } catch (e) {
      console.error(e);
    }
    const monitors = createBinding(app, "monitors");
    return (
      <For each={monitors}>
        {(gdkmonitor) => (
          <This this={app}>
            <Bar gdkmonitor={gdkmonitor} />
            <SettingsWindow gdkmonitor={gdkmonitor} />
            <VolumePopup gdkmonitor={gdkmonitor} />
            <NotificationPopups />
            <Sidebar gdkmonitor={gdkmonitor} />
            <PowerMenu gdkmonitor={gdkmonitor} />
            <MusicPopup gdkmonitor={gdkmonitor} />
          </This>
        )}
      </For>
    );
  },
});
