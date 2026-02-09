import { createBinding } from "ags";
import AstalWp from "gi://AstalWp";
import GLib from "gi://GLib";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Cairo from "gi://cairo";

export default function VolumePopup({ gdkmonitor }: { gdkmonitor: any }) {
  const speaker = AstalWp.get_default()?.audio.defaultSpeaker;
  if (!speaker) return <box />;

  let timeoutId: number | null = null;

  const init = (revealer: Gtk.Revealer, levelbar: Gtk.LevelBar) => {
    let volumeSignal: number | null = null;
    let muteSignal: number | null = null;

    const window = revealer.get_root() as Gtk.Window;
    if (!window) return;

    const updateLevel = () => {
      const vol = speaker.volume;
      levelbar.value = vol > 1 ? 1 : vol;
    };
    updateLevel();

    const show = () => {
      if (!window) return;

      updateLevel();

      if (!window.visible) {
        window.set_visible(true);
      }

      revealer.reveal_child = true;

      if (timeoutId) GLib.source_remove(timeoutId);

      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        revealer.reveal_child = false;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          if (!revealer.reveal_child && window) {
            window.set_visible(false);
          }
          return GLib.SOURCE_REMOVE;
        });
        timeoutId = null;
        return GLib.SOURCE_REMOVE;
      });
    };

    volumeSignal = speaker.connect("notify::volume", show);
    muteSignal = speaker.connect("notify::mute", show);

    // Clean up signals when revealer is destroyed
    revealer.connect("destroy", () => {
      if (timeoutId) GLib.source_remove(timeoutId);
      if (volumeSignal) speaker.disconnect(volumeSignal);
      if (muteSignal) speaker.disconnect(muteSignal);
    });
  };

  return (
    <window
      gdkmonitor={gdkmonitor}
      name={`volume-popup-${gdkmonitor.connector}`}
      cssClasses={["VolumePopup"]}
      namespace="volume-popup"
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
          <image iconName={createBinding(speaker, "volumeIcon")} />
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
