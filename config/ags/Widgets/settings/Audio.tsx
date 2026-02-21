import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import AstalWp from "gi://AstalWp";
// Use the shared Variable from utils instead of a local duplicate.
import { Variable } from "../../utils/Variable";

function execSync(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success && stdout) return new TextDecoder().decode(stdout).trim();
  } catch (err) {
    console.error(`Failed to execute: ${cmd}`, err);
  }
  return "";
}

function execAsyncNoWait(cmd: string): void {
  try {
    GLib.spawn_command_line_async(cmd);
  } catch (err) {
    console.error(`Failed to execute: ${cmd}`, err);
  }
}

function readKeybindsFile(): string {
  const configPath = `${GLib.get_home_dir()}/.config/hypr/hyprland/keybinds.conf`;
  try {
    const [success, contents] = GLib.file_get_contents(configPath);
    if (success) return new TextDecoder().decode(contents);
  } catch (err) {
    console.error("Failed to read keybinds.conf:", err);
  }
  return "";
}

function getCurrentLimit(): number {
  const match = readKeybindsFile().match(/--limit=([\d.]+)/);
  return match ? parseFloat(match[1]) : 1.0;
}

function updateKeybindsLimit(newLimit: number): boolean {
  const configPath = `${GLib.get_home_dir()}/.config/hypr/hyprland/keybinds.conf`;
  const contents = readKeybindsFile();
  if (!contents) return false;

  const updated = contents.replace(
    /--limit=([\d.]+)/,
    `--limit=${newLimit.toFixed(1)}`,
  );
  try {
    GLib.file_set_contents(configPath, updated);
    execAsyncNoWait("hyprctl reload");
    return true;
  } catch (err) {
    console.error("Failed to update keybinds.conf:", err);
    return false;
  }
}

export default function AudioPage() {
  const wp = AstalWp.get_default();
  const speaker = wp?.audio.defaultSpeaker;

  if (!speaker) {
    return (
      <Gtk.Box cssClasses={["page-container"]}>
        <Gtk.Label label="Audio device not available" />
      </Gtk.Box>
    );
  }

  const maxVolume = new Variable(getCurrentLimit());
  let maxVolumeEntry: any = null;

  const setMaxVolume = (decimal: number) => {
    if (decimal < 0.01 || decimal > 5.0) return;
    if (updateKeybindsLimit(decimal)) {
      maxVolume.set(decimal);
      execAsyncNoWait(
        `wpctl set-volume @DEFAULT_AUDIO_SINK@ ${speaker.volume} --limit ${decimal}`,
      );
    }
  };

  const applyMaxVolume = () => {
    if (!maxVolumeEntry) return;
    const percent = parseInt(maxVolumeEntry.get_text());
    if (!isNaN(percent)) setMaxVolume(percent / 100);
  };

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
    >
      <Gtk.Label label="Audio" xalign={0} cssClasses={["page-title"]} />

      {/* Current volume */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={16}
      >
        <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
          <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
            <Gtk.Label
              label="Current Volume"
              xalign={0}
              cssClasses={["section-title"]}
            />
            <Gtk.Label
              $={(self: any) => {
                const update = () =>
                  self.set_label(`${Math.round(speaker.volume * 100)}%`);
                const id = speaker.connect("notify::volume", update);
                update();
                self.connect("destroy", () => speaker.disconnect(id));
              }}
              xalign={0}
              cssClasses={["dim-label"]}
            />
          </Gtk.Box>
          <Gtk.Button
            $={(self: any) => {
              const update = () => {
                self.set_icon_name(
                  speaker.mute
                    ? "audio-volume-muted-symbolic"
                    : "audio-volume-high-symbolic",
                );
                self.set_tooltip_text(speaker.mute ? "Unmute" : "Mute");
              };
              const id = speaker.connect("notify::mute", update);
              update();
              self.connect("destroy", () => speaker.disconnect(id));
            }}
            onClicked={() => speaker.set_mute(!speaker.mute)}
            cssClasses={["icon-button"]}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Max volume limit */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={16}
      >
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
          <Gtk.Label
            label="Maximum Volume Limit"
            xalign={0}
            cssClasses={["section-title"]}
          />
          <Gtk.Label
            label="Updates Hyprland keybind --limit flag (1-500%)"
            xalign={0}
            cssClasses={["dim-label"]}
            wrap
          />
        </Gtk.Box>
        <Gtk.Box
          orientation={Gtk.Orientation.HORIZONTAL}
          spacing={12}
          halign={Gtk.Align.START}
        >
          <Gtk.Entry
            widthRequest={100}
            placeholderText="100"
            $={(self: any) => {
              maxVolumeEntry = self;
              const unsub = maxVolume.subscribe((max) =>
                self.set_text(Math.round(max * 100).toString()),
              );
              const id = self.connect("activate", applyMaxVolume);
              self.connect("destroy", () => {
                unsub();
                self.disconnect(id);
              });
            }}
          />
          <Gtk.Label
            label="%"
            cssClasses={["dim-label"]}
            valign={Gtk.Align.CENTER}
          />
          <Gtk.Button label="Apply" onClicked={applyMaxVolume} />
        </Gtk.Box>
        <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
          {[100, 125, 150, 175, 200].map((percent) => (
            <Gtk.Button
              label={`${percent}%`}
              $={(self: any) => {
                const unsub = maxVolume.subscribe((max) => {
                  self.set_css_classes(
                    Math.round(max * 100) === percent
                      ? ["volume-preset-btn", "active"]
                      : ["volume-preset-btn"],
                  );
                });
                self.connect("destroy", unsub);
              }}
              onClicked={() => setMaxVolume(percent / 100)}
            />
          ))}
        </Gtk.Box>
      </Gtk.Box>

      {/* Device info */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={10}
      >
        <Gtk.Label
          label="Pipewire Information"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Label
          $={(self: any) => {
            const update = () =>
              self.set_label(
                `Active Output: ${speaker.description || "Unknown Device"}`,
              );
            const id = speaker.connect("notify::description", update);
            update();
            self.connect("destroy", () => speaker.disconnect(id));
          }}
          xalign={0}
          cssClasses={["dim-label"]}
        />
      </Gtk.Box>
    </Gtk.Box>
  );
}
