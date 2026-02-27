import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Cairo from "gi://cairo";

// ── Sysfs brightness helpers ──────────────────────────────────────────────────

function readSysfs(path: string): string {
  try {
    const [ok, out] = GLib.spawn_command_line_sync(`cat ${path}`);
    if (ok && out) return new TextDecoder().decode(out).trim();
  } catch (_) {}
  return "0";
}

function findBacklightPath(): string | null {
  try {
    const dir = Gio.File.new_for_path("/sys/class/backlight");
    const iter = dir.enumerate_children(
      "standard::name",
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    const info = iter.next_file(null);
    if (info) return `/sys/class/backlight/${info.get_name()}`;
  } catch (_) {}
  return null;
}

function getBrightnessRatio(basePath: string): number {
  const cur = Number(readSysfs(`${basePath}/brightness`));
  const max = Number(readSysfs(`${basePath}/max_brightness`)) || 100;
  return Math.min(cur / max, 1);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BrightnessPopup({ gdkmonitor }: { gdkmonitor: any }) {
  const backlightPath = findBacklightPath();
  if (!backlightPath) return <box />;

  let timeoutId: number | null = null;

  const init = (revealer: Gtk.Revealer, levelbar: Gtk.LevelBar) => {
    const window = revealer.get_root() as Gtk.Window;
    if (!window) return;

    const updateLevel = () => {
      levelbar.value = getBrightnessRatio(backlightPath);
    };
    updateLevel();

    const show = () => {
      updateLevel();

      if (!window.visible) window.set_visible(true);
      revealer.reveal_child = true;

      if (timeoutId) GLib.source_remove(timeoutId);
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        revealer.reveal_child = false;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          if (!revealer.reveal_child && window) window.set_visible(false);
          return GLib.SOURCE_REMOVE;
        });
        timeoutId = null;
        return GLib.SOURCE_REMOVE;
      });
    };

    // Watch the sysfs brightness file for changes
    let monitor: Gio.FileMonitor | null = null;
    let monitorSignal: number | null = null;
    try {
      const file = Gio.File.new_for_path(`${backlightPath}/brightness`);
      monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
      monitorSignal = monitor.connect("changed", show);
    } catch (_) {}

    revealer.connect("destroy", () => {
      if (timeoutId) GLib.source_remove(timeoutId);
      if (monitor && monitorSignal !== null) {
        try {
          monitor.disconnect(monitorSignal);
        } catch (_) {}
        try {
          monitor.cancel();
        } catch (_) {}
      }
    });
  };

  return (
    <window
      gdkmonitor={gdkmonitor}
      name={`brightness-popup-${gdkmonitor.connector}`}
      cssClasses={["VolumePopup"]}
      namespace="brightness-popup"
      anchor={Astal.WindowAnchor.BOTTOM}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      visible={false}
      $={(self) => {
        const region = new Cairo.Region();
        self.input_region = region;
      }}
    >
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_UP}
        reveal_child={false}
        transitionDuration={300}
        valign={Gtk.Align.END}
        $={(self) => {
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const lb = self.get_child().get_last_child() as Gtk.LevelBar;
            init(self, lb);
            return GLib.SOURCE_REMOVE;
          });
        }}
      >
        <box
          cssClasses={["container"]}
          valign={Gtk.Align.END}
          orientation={Gtk.Orientation.HORIZONTAL}
          spacing={12}
        >
          <image iconName="display-brightness-symbolic" />
          <levelbar
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.FILL}
            hexpand={true}
            widthRequest={150}
            heightRequest={6}
            minValue={0}
            maxValue={1}
            mode={Gtk.LevelBarMode.CONTINUOUS}
          />
        </box>
      </revealer>
    </window>
  );
}
