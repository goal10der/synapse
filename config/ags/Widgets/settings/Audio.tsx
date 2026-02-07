import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import AstalWp from "gi://AstalWp";

// Simple Variable class for state management
class Variable<T> {
  private value: T;
  private subscribers: Array<(value: T) => void> = [];

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  set(newValue: T) {
    this.value = newValue;
    this.subscribers.forEach((callback) => callback(this.value));
  }

  subscribe(callback: (value: T) => void) {
    this.subscribers.push(callback);
    callback(this.value);
  }
}

function execSync(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success && stdout) {
      return new TextDecoder().decode(stdout).trim();
    }
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
    if (success) {
      return new TextDecoder().decode(contents);
    }
  } catch (err) {
    console.error("Failed to read keybinds.conf:", err);
  }
  return "";
}

function getCurrentLimit(): number {
  const contents = readKeybindsFile();
  const match = contents.match(/--limit=([\d.]+)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return 1.0; // Default
}

function updateKeybindsLimit(newLimit: number): boolean {
  const configPath = `${GLib.get_home_dir()}/.config/hypr/hyprland/keybinds.conf`;
  const contents = readKeybindsFile();

  if (!contents) return false;

  // Replace the --limit value in the volume keybind
  const updatedContents = contents.replace(
    /--limit=([\d.]+)/,
    `--limit=${newLimit.toFixed(1)}`,
  );

  try {
    GLib.file_set_contents(configPath, updatedContents);
    // Reload Hyprland config
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
    if (decimal < 0.01 || decimal > 5.0) return; // Reasonable bounds (1% to 500%)

    if (updateKeybindsLimit(decimal)) {
      maxVolume.set(decimal);

      // Apply the limit immediately to current volume
      execAsyncNoWait(
        `wpctl set-volume @DEFAULT_AUDIO_SINK@ ${speaker.volume} --limit ${decimal}`,
      );
    }
  };

  const applyMaxVolume = () => {
    if (maxVolumeEntry) {
      const percent = parseInt(maxVolumeEntry.get_text());
      if (!isNaN(percent)) {
        setMaxVolume(percent / 100);
      }
    }
  };

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
    >
      <Gtk.Label label="Audio" xalign={0} cssClasses={["page-title"]} />

      {/* Current Volume Display */}
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
                const updateVolume = () => {
                  const percent = Math.round(speaker.volume * 100);
                  self.set_label(`${percent}%`);
                };
                speaker.connect("notify::volume", updateVolume);
                updateVolume();
              }}
              xalign={0}
              cssClasses={["dim-label"]}
            />
          </Gtk.Box>
          <Gtk.Button
            $={(self: any) => {
              const updateMuteIcon = () => {
                const icon = speaker.mute
                  ? "audio-volume-muted-symbolic"
                  : "audio-volume-high-symbolic";
                self.set_icon_name(icon);
                self.set_tooltip_text(speaker.mute ? "Unmute" : "Mute");
              };
              speaker.connect("notify::mute", updateMuteIcon);
              updateMuteIcon();
            }}
            onClicked={() => speaker.set_mute(!speaker.mute)}
            cssClasses={["icon-button"]}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Max Volume Limit */}
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
            wrap={true}
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
              maxVolume.subscribe((max) => {
                self.set_text(Math.round(max * 100).toString());
              });

              self.connect("activate", applyMaxVolume);
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
                maxVolume.subscribe((max) => {
                  const currentPercent = Math.round(max * 100);
                  const classes =
                    currentPercent === percent
                      ? ["volume-preset-btn", "active"]
                      : ["volume-preset-btn"];
                  self.set_css_classes(classes);
                });
              }}
              onClicked={() => setMaxVolume(percent / 100)}
            />
          ))}
        </Gtk.Box>
      </Gtk.Box>
      {/* Audio Device Info */}
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
            const updateDevice = () => {
              self.set_label(
                `Active Output: ${speaker.description || "Unknown Device"}`,
              );
            };
            speaker.connect("notify::description", updateDevice);
            updateDevice();
          }}
          xalign={0}
          cssClasses={["dim-label"]}
        />
      </Gtk.Box>
    </Gtk.Box>
  );
}
