import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import AppearancePage from "./settings/Appearance";
import NetworkPage from "./settings/Network";
import AudioPage from "./settings/Audio";
import BluetoothPage from "./settings/Bluetooth";
const SAVE_PATH = `${GLib.get_user_cache_dir()}/ags/settings.json`;
import { Variable } from "../utils/Variable";

function loadSavedValue(key: string, defaultValue: any) {
  try {
    const [success, content] = GLib.file_get_contents(SAVE_PATH);
    if (success) {
      const cache = JSON.parse(new TextDecoder().decode(content));
      return cache[key] !== undefined ? cache[key] : defaultValue;
    }
  } catch (e) {}
  return defaultValue;
}

function saveToDisk(key: string, value: any) {
  try {
    let cache: any = {};
    try {
      const [success, content] = GLib.file_get_contents(SAVE_PATH);
      if (success) cache = JSON.parse(new TextDecoder().decode(content));
    } catch (e) {}

    cache[key] = value;
    const dir = GLib.path_get_dirname(SAVE_PATH);
    GLib.mkdir_with_parents(dir, 0o755);
    GLib.file_set_contents(SAVE_PATH, JSON.stringify(cache));
  } catch (e) {
    console.error(`Failed to save ${key} to disk:`, e);
  }
}
export const workspaceCount = new Variable(loadSavedValue("workspaceCount", 5));

export const setWorkspaceCount = (val: number) => {
  if (val >= 1 && val <= 10) {
    workspaceCount.set(val);
    saveToDisk("workspaceCount", val);
  }
};
export function execAsync(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const success = GLib.spawn_command_line_async(cmd);
      if (success) resolve();
      else reject(new Error(`Failed to launch: ${cmd}`));
    } catch (err) {
      reject(err);
    }
  });
}

export const matugenState = { currentTonalSpot: "scheme-tonal-spot" };

export const runMatugen = (spot: string, imagePath?: string) => {
  matugenState.currentTonalSpot = spot;

  const targetImage = imagePath
    ? `"${imagePath}"`
    : `$(awww query | sed -n "s/.*image: //p" | cut -d: -f1 | head -n1)`;
  const cmd = `bash -c 'matugen image -t ${spot} "${targetImage}"'`;
  execAsync(cmd);
};
function TabButton({ label, id, activeTab, icon }: any) {
  return (
    <Gtk.Button
      cssClasses={["sidebar-tab"]}
      $={(self: any) => {
        const updateClasses = (val: string) => {
          const classes =
            val === id ? ["sidebar-tab", "active"] : ["sidebar-tab"];
          self.set_css_classes(classes);
        };

        activeTab.subscribe(updateClasses);

        self.connect("destroy", () => {
          activeTab.unsubscribe(updateClasses);
        });
      }}
      onClicked={() => activeTab.set(id)}
    >
      <Gtk.Box spacing={12} halign={Gtk.Align.START}>
        <Gtk.Image iconName={icon} />
        <Gtk.Label label={label} />
      </Gtk.Box>
    </Gtk.Button>
  );
}
export default function SettingsWindow({ gdkmonitor }: { gdkmonitor: any }) {
  const activeTab = new Variable("appearance");
  const monitorWidth = gdkmonitor.geometry.width || 1920;
  const scaleFactor = monitorWidth / 1920;

  return (
    <window
      name={`settings-window-${gdkmonitor.connector}`}
      cssClasses={["SettingsWindow"]}
      gdkmonitor={gdkmonitor}
      visible={false}
      application={app}
      keymode={Astal.Keymode.ON_DEMAND}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      widthRequest={Math.round(1200 * scaleFactor)}
      heightRequest={Math.round(550 * scaleFactor)}
      resizable={false}
    >
      <Gtk.Box
        orientation={Gtk.Orientation.HORIZONTAL}
        cssClasses={["settings-container"]}
      >
        {/* --- SIDEBAR --- */}
        <Gtk.ScrolledWindow
          widthRequest={Math.round(250 * scaleFactor)}
          vexpand
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["settings-sidebar"]}
            spacing={12}
          >
            <Gtk.Label
              label="Settings"
              cssClasses={["settings-sidebar-title"]}
              xalign={0}
            />

            <TabButton
              label="Appearance"
              id="appearance"
              activeTab={activeTab}
              icon="preferences-desktop-theme-symbolic"
            />
            <TabButton
              label="Network"
              id="network"
              activeTab={activeTab}
              icon="network-wireless-symbolic"
            />
            <TabButton
              label="Bluetooth"
              id="bluetooth"
              activeTab={activeTab}
              icon="bluetooth-symbolic"
            />
            <TabButton
              label="Audio"
              id="audio"
              activeTab={activeTab}
              icon="audio-speakers-symbolic"
            />

            <Gtk.Box vexpand />
            <Gtk.Button
              label="Close"
              cssClasses={["settings-close-btn"]}
              onClicked={(self: any) => {
                self.get_root().visible = false;
              }}
            />
          </Gtk.Box>
        </Gtk.ScrolledWindow>

        <Gtk.Separator orientation={Gtk.Orientation.VERTICAL} />

        {/* --- MAIN CONTENT --- */}
        <Gtk.ScrolledWindow
          hexpand
          vexpand
          hscrollbarPolicy={Gtk.PolicyType.NEVER}
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["settings-main-content"]}
            hexpand
            vexpand
          >
            <Gtk.Stack
              hexpand
              vexpand
              transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
              $={(self) => {
                self.add_named(
                  <AppearancePage scaleFactor={scaleFactor} />,
                  "appearance",
                );
                self.add_named(<NetworkPage />, "network");
                self.add_named(<BluetoothPage />, "bluetooth");
                self.add_named(<AudioPage />, "audio");

                self.set_visible_child_name("appearance");

                const switchTab = (tabName: string) => {
                  self.set_visible_child_name(tabName);
                };

                activeTab.subscribe(switchTab);

                self.connect("destroy", () => {
                  activeTab.unsubscribe(switchTab);
                });
              }}
            />
          </Gtk.Box>
        </Gtk.ScrolledWindow>
      </Gtk.Box>
    </window>
  );
}
