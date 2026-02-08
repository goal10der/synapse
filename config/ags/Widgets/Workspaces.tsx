import Hyprland from "gi://AstalHyprland";
import Gtk from "gi://Gtk?version=4.0";
import { workspaceCount } from "./Settings";

export default function Workspaces() {
  const hypr = Hyprland.get_default();

  return (
    <box
      cssClasses={["workspaces-container"]}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      heightRequest={24}
      $={(self) => {
        const syncDots = (count: number) => {
          if (count === undefined) return;
          let child = self.get_first_child();
          while (child) {
            const next = child.get_next_sibling();
            self.remove(child);
            child = next;
          }
          for (let i = 1; i <= count; i++) {
            const dot = new Gtk.Box({
              css_classes: ["dot"],
              valign: Gtk.Align.CENTER,
            });
            const updateActive = () => {
              const focusedWs = hypr.get_focused_workspace();
              if (focusedWs?.id === i) {
                dot.add_css_class("active");
              } else {
                dot.remove_css_class("active");
              }
            };
            const signalId = hypr.connect(
              "notify::focused-workspace",
              updateActive,
            );
            dot.connect("destroy", () => hypr.disconnect(signalId));
            updateActive();
            self.append(dot);
          }
        };
        workspaceCount.subscribe(syncDots);
      }}
    />
  );
}
