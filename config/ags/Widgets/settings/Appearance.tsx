import Gtk from "gi://Gtk?version=4.0";
import WallpaperPicker from "./WallpaperPicker";
// Import the state object instead of the let variable
import { matugenState, runMatugen } from "../Settings";
import Notifd from "gi://AstalNotifd";
import { createState } from "ags";
import { workspaceCount, setWorkspaceCount } from "../Settings"; // Adjust path

// Create a global state for notification timeout (in milliseconds)
export const [notificationTimeout, setNotificationTimeout] = createState(5000); // Default 5000ms

export default function AppearancePage({
  scaleFactor,
}: {
  scaleFactor: number;
}) {
  const notifd = Notifd.get_default();

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
                    setNotificationTimeout(value);
                  } else {
                    // Reset to current value if invalid
                    updateValue();
                  }
                };

                // When user presses Enter
                self.connect("activate", applyValue);

                // When user focuses away - use GTK4 event controller
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
                // Sync entry text with state (with safety check)
                const syncText = (val: number) => {
                  if (val !== undefined && val !== null) {
                    self.text = val.toString();
                  }
                };

                syncText(workspaceCount.get());
                workspaceCount.subscribe(syncText);

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
      {/* MATUGEN TONAL SPOT Section */}
      <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <Gtk.Label
          label="MATUGEN TONAL SPOT"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Box halign={Gtk.Align.START} valign={Gtk.Align.START}>
          <Gtk.DropDown
            cssClasses={["tonal-dropdown"]}
            widthRequest={180} // Made it wider to avoid the "tiny square" look
            heightRequest={36} // Standard height
            valign={Gtk.Align.CENTER}
            model={Gtk.StringList.new(tonalSpotsName)}
            $={(self) => {
              // Target the main toggle button
              const btn = self.get_first_child();
              if (btn) btn.add_css_class("tonal-main-btn");

              self.selected = tonalSpots.indexOf(matugenState.currentTonalSpot);
              self.connect("notify::selected", () => {
                const selected = tonalSpots[self.selected];
                runMatugen(selected);
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>
      {/* WALLPAPERS Section */}
      <Gtk.Label label="WALLPAPERS" xalign={0} cssClasses={["section-title"]} />
      <WallpaperPicker />
    </Gtk.Box>
  );
}
