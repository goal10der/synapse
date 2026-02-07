import Hyprland from "gi://AstalHyprland";
import Gtk from "gi://Gtk?version=4.0";
import { workspaceCount } from "./Settings"; // Adjust path
export default function Workspaces() {
  const hypr = Hyprland.get_default();

  return (
    <box
      cssClasses={["workspaces-container"]}
      halign={Gtk.Align.CENTER}
      $={(self) => {
        const syncDots = (count: number) => {
          if (count === undefined) return;

          // 1. Clear old dots
          let child = self.get_first_child();
          while (child) {
            const next = child.get_next_sibling();
            self.remove(child);
            child = next;
          }

          // 2. Build dots using raw Gtk constructor
          for (let i = 1; i <= count; i++) {
            const dot = new Gtk.Box({
              css_classes: ["dot"],
            });

            // Update function for active state
            const updateActive = () => {
              const focusedWs = hypr.get_focused_workspace();
              if (focusedWs?.id === i) {
                dot.add_css_class("active");
              } else {
                dot.remove_css_class("active");
              }
            };

            // Connect to Hyprland signal
            const signalId = hypr.connect(
              "notify::focused-workspace",
              updateActive,
            );

            // Cleanup signal when dot is destroyed
            dot.connect("destroy", () => hypr.disconnect(signalId));

            // Set initial active state
            updateActive();

            self.append(dot);
          }
        };

        // Sync with your variable
        workspaceCount.subscribe(syncDots);
      }}
    />
  );
}
