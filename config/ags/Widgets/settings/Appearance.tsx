import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import WallpaperPicker from "./WallpaperPicker";
import { matugenState, runMatugen } from "../Settings";
import { Variable } from "../../utils/Variable";
import { workspaceCount, setWorkspaceCount } from "../Settings";

// Use Variable so Notificationpopup can call .get() and .subscribe() on it
export const notificationTimeout = new Variable(5000);

export default function AppearancePage({
  scaleFactor,
}: {
  scaleFactor: number;
}) {
  // Debounce timer ID for Matugen
  let matugenTimeoutId: number | null = null;

  const tonalSpots = [
    "scheme-content",
    "scheme-expressive",
    "scheme-fidelity",
    "scheme-fruit-salad",
    "scheme-monochrome",
    "scheme-neutral",
    "scheme-rainbow",
    "scheme-tonal-spot",
    "scheme-vibrant",
  ];

  const tonalSpotsName = [
    "content",
    "expressive",
    "fidelity",
    "fruit salad",
    "monochrome",
    "neutral",
    "rainbow",
    "tonal spot",
    "vibrant",
  ];

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={20}
      cssClasses={["page-container"]}
    >
      <Gtk.Label label="Appearance" xalign={0} cssClasses={["page-title"]} />

      {/* NOTIFICATION TIMEOUT Section */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <Gtk.Label
          label="NOTIFICATION TIMEOUT"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
          cssClasses={["settings-card"]}
        >
          <Gtk.Box spacing={12}>
            <Gtk.Label
              label="Popup Duration (milliseconds)"
              halign={Gtk.Align.START}
              hexpand
            />
            <Gtk.Entry
              widthRequest={80}
              $={(self) => {
                const updateValue = () => {
                  self.text = notificationTimeout.get().toString();
                };
                updateValue();

                const applyValue = () => {
                  const value = parseInt(self.text);
                  if (!isNaN(value) && value >= 1000 && value <= 30000) {
                    notificationTimeout.set(value);
                  } else {
                    updateValue();
                  }
                };
                self.connect("activate", applyValue);
                const focusController = new Gtk.EventControllerFocus();
                focusController.connect("leave", applyValue);
                self.add_controller(focusController);
              }}
            />
          </Gtk.Box>

          <Gtk.Label
            label="How long notification popups stay on screen before auto-dismissing (1000-30000ms)"
            xalign={0}
            wrap
            cssClasses={["dim-label"]}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* WORKSPACES Section */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <Gtk.Label
          label="WORKSPACES"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Box spacing={12} cssClasses={["settings-card"]}>
          <Gtk.Label
            label="Number of Workspaces Shown"
            hexpand
            halign={Gtk.Align.START}
          />

          <Gtk.Box cssClasses={["counter-control"]} spacing={4}>
            <Gtk.Button
              label="-"
              onClicked={() => {
                const current = workspaceCount.get();
                if (current > 1) setWorkspaceCount(current - 1);
              }}
            />

            <Gtk.Entry
              widthRequest={50}
              halign={Gtk.Align.CENTER}
              $={(self) => {
                const syncText = (val: number) => {
                  if (val !== undefined && val !== null) {
                    self.text = val.toString();
                  }
                };

                syncText(workspaceCount.get());
                const unsub = workspaceCount.subscribe(syncText);

                const apply = () => {
                  const val = parseInt(self.text);
                  if (!isNaN(val) && val > 0 && val <= 20) {
                    setWorkspaceCount(val);
                  } else {
                    self.text = workspaceCount.get().toString();
                  }
                };

                self.connect("activate", apply);
                const focus = new Gtk.EventControllerFocus();
                focus.connect("leave", apply);
                self.add_controller(focus);
                // Unsubscribe when widget is destroyed to avoid leak
                self.connect("destroy", unsub);
              }}
            />

            <Gtk.Button
              label="+"
              onClicked={() => {
                const current = workspaceCount.get();
                if (current < 20) setWorkspaceCount(current + 1);
              }}
            />
          </Gtk.Box>
        </Gtk.Box>
      </Gtk.Box>

      {/* MATUGEN Section with Debounce */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <Gtk.Label
          label="MATUGEN TONAL SPOT"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Box halign={Gtk.Align.START} valign={Gtk.Align.START}>
          <Gtk.DropDown
            cssClasses={["tonal-dropdown"]}
            widthRequest={180}
            heightRequest={36}
            valign={Gtk.Align.CENTER}
            model={Gtk.StringList.new(tonalSpotsName)}
            $={(self) => {
              const btn = self.get_first_child();
              if (btn) btn.add_css_class("tonal-main-btn");

              self.selected = tonalSpots.indexOf(matugenState.currentTonalSpot);

              self.connect("notify::selected", () => {
                const selected = tonalSpots[self.selected];

                if (matugenTimeoutId !== null) {
                  GLib.source_remove(matugenTimeoutId);
                }

                matugenTimeoutId = GLib.timeout_add(
                  GLib.PRIORITY_DEFAULT,
                  500,
                  () => {
                    runMatugen(selected);
                    matugenTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                  },
                );
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

      <Gtk.Label label="WALLPAPERS" xalign={0} cssClasses={["section-title"]} />
      <WallpaperPicker />
    </Gtk.Box>
  );
}
