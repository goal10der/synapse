import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import AstalBluetooth from "gi://AstalBluetooth?version=0.1";
import AstalNetwork from "gi://AstalNetwork?version=0.1";
import AstalWp from "gi://AstalWp?version=0.1";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { onCleanup } from "ags";

// Page imports
import NetworkPage from "./settings/Network";
import BluetoothPage from "./settings/Bluetooth";

/* --- CUSTOM SHELL HELPERS --- */
function exec(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success) return new TextDecoder().decode(stdout).trim();
  } catch (e) {
    console.error(e);
  }
  return "";
}

async function execAsync(cmd: string): Promise<string> {
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  });
  const argv = GLib.shell_parse_argv(cmd)[1];
  const proc = launcher.spawnv(argv);
  return new Promise((resolve) => {
    proc.communicate_utf8_async(null, null, (p, res) => {
      const [_, stdout] = p!.communicate_utf8_finish(res);
      resolve(stdout ? stdout.trim() : "");
    });
  });
}

/* --- STATE HELPER --- */
function createVar<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<(val: T) => void>();
  return {
    get: () => value,
    set: (val: T) => {
      if (value !== val) {
        value = val;
        listeners.forEach((l) => l(val));
      }
    },
    subscribe: (cb: (val: T) => void) => {
      listeners.add(cb);
      cb(value);
      return () => listeners.delete(cb);
    },
  };
}

const wp = AstalWp.get_default();
const maxBrightness = Number(exec("brightnessctl max")) || 100;
const brightness = createVar(0);

// Polling for external brightness changes
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
  execAsync("brightnessctl get").then((out) =>
    brightness.set(Number(out) / maxBrightness),
  );
  return true;
});

export default function RightSidebar({
  gdkmonitor,
}: {
  gdkmonitor: Gdk.Monitor;
}) {
  let win: Astal.Window;
  let stack: Gtk.Stack;

  /* --- UI COMPONENTS --- */

  const Header = () => (
    <box cssClasses={["sidebar-header"]} spacing={12} marginBottom={8}>
      <label
        label="Quick Settings"
        hexpand
        xalign={0}
        cssClasses={["sidebar-title"]}
      />
      <button
        cssClasses={["powermenu-toggle"]}
        onClicked={() => {
          // Toggles the Power Menu window
          app.toggle_window(`powermenu-${gdkmonitor.connector}`);
          // Hide sidebar when power menu opens for a cleaner UI
          win.hide();
        }}
      >
        <image iconName="system-shutdown-symbolic" />
      </button>
    </box>
  );

  const VolumeSlider = () => (
    <box cssClasses={["qs-slider-container"]} spacing={12}>
      <image iconName="audio-speakers-symbolic" />
      <slider
        hexpand
        onValueChanged={(self) => {
          if (wp?.audio?.defaultSpeaker)
            wp.audio.defaultSpeaker.volume = self.value;
        }}
        $={(self) => {
          const sync = () => {
            if (wp?.audio?.defaultSpeaker)
              self.value = wp.audio.defaultSpeaker.volume;
          };
          sync();
          wp?.audio?.defaultSpeaker?.connect("notify::volume", sync);
        }}
      />
    </box>
  );

  const BrightnessSlider = () => (
    <box cssClasses={["qs-slider-container"]} spacing={12}>
      <image iconName="display-brightness-symbolic" />
      <slider
        hexpand
        onValueChanged={(self) => {
          execAsync(`brightnessctl set ${Math.floor(self.value * 100)}%`);
          brightness.set(self.value);
        }}
        $={(self) => {
          const unsub = brightness.subscribe((v) => {
            if (Math.abs(self.value - v) > 0.01) self.value = v;
          });
          onCleanup(unsub);
        }}
      />
    </box>
  );

  /* --- PAGES --- */

  const mainPage = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={16}
      cssClasses={["main-sidebar-page"]}
    >
      <Header />

      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        cssClasses={["sliders-section"]}
      >
        <VolumeSlider />
        <BrightnessSlider />
      </box>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
        <button
          cssClasses={["qs-tile"]}
          onClicked={() => stack.set_visible_child_name("wifi")}
        >
          <box spacing={12}>
            <image iconName="network-wireless-symbolic" />
            <label label="Wi-Fi Settings" hexpand xalign={0} />
            <image iconName="go-next-symbolic" />
          </box>
        </button>
        <button
          cssClasses={["qs-tile"]}
          onClicked={() => stack.set_visible_child_name("bluetooth")}
        >
          <box spacing={12}>
            <image iconName="bluetooth-symbolic" />
            <label label="Bluetooth Settings" hexpand xalign={0} />
            <image iconName="go-next-symbolic" />
          </box>
        </button>
      </box>
    </box>
  );

  const wifiPageContainer = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
      <button
        onClicked={() => stack.set_visible_child_name("main")}
        halign={Gtk.Align.START}
        cssClasses={["back-button"]}
      >
        <box spacing={8}>
          <image iconName="go-previous-symbolic" />
          <label label="Back" />
        </box>
      </button>
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <NetworkPage />
        </box>
      </scrolledwindow>
    </box>
  );

  const bluetoothPageContainer = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
      <button
        onClicked={() => stack.set_visible_child_name("main")}
        halign={Gtk.Align.START}
        cssClasses={["back-button"]}
      >
        <box spacing={8}>
          <image iconName="go-previous-symbolic" />
          <label label="Back" />
        </box>
      </button>
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <BluetoothPage />
        </box>
      </scrolledwindow>
    </box>
  );

  /* --- WINDOW --- */

  return (
    <window
      $={(self) => {
        win = self;
        const keys = new Gtk.EventControllerKey();
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            if (stack.visible_child_name !== "main")
              stack.set_visible_child_name("main");
            else self.hide();
            return Gdk.EVENT_STOP;
          }
          return Gdk.EVENT_PROPAGATE;
        });
        self.add_controller(keys);
      }}
      visible={false}
      namespace="sidebar"
      name={`RightSidebar-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.RIGHT |
        Astal.WindowAnchor.BOTTOM
      }
      exclusivity={Astal.Exclusivity.NORMAL}
      application={app}
      layer={Astal.Layer.OVERLAY}
      keymode={Astal.Keymode.ON_DEMAND}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["sidebar-container"]}
        widthRequest={350}
      >
        <stack
          $={(self) => {
            stack = self;
            self.add_named(mainPage, "main");
            self.add_named(wifiPageContainer, "wifi");
            self.add_named(bluetoothPageContainer, "bluetooth");
            self.set_visible_child_name("main");
          }}
          vexpand
          transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
          transitionDuration={250}
        />
      </box>
    </window>
  );
}
