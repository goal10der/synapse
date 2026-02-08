import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { onCleanup } from "ags";
import Workspaces from "./Widgets/Workspaces";
import Clock from "./Widgets/Clock";
import Tray from "./Widgets/Tray";
import Battery from "./Widgets/Battry";

export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let win: Astal.Window;
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;

  onCleanup(() => {
    win?.destroy();
  });

  return (
    <window
      $={(self) => (win = self)}
      visible
      namespace="bar"
      name={`bar-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      cssClasses={["bar"]}
    >
      <centerbox heightRequest={24} valign={Gtk.Align.CENTER}>
        <box $type="start" valign={Gtk.Align.CENTER} spacing={4}>
          <Clock gdkmonitor={gdkmonitor} />
          <button
            onClicked={() =>
              app.toggle_window(`settings-window-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button"]}
            valign={Gtk.Align.CENTER}
            heightRequest={24}
          >
            <image iconName="emblem-system-symbolic" pixelSize={14} />
          </button>
        </box>

        <box $type="center" valign={Gtk.Align.CENTER}>
          <Workspaces />
        </box>

        <box $type="end" spacing={8} valign={Gtk.Align.CENTER}>
          <Tray />

          {/* THE SIDEBAR BUTTON FIX */}
          <button
            onClicked={() =>
              // FIXED: Updated name to RightSidebar
              app.toggle_window(`RightSidebar-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button", "sidebar-toggle"]}
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            heightRequest={24}
            widthRequest={24}
          >
            <image
              iconName="open-menu-symbolic"
              pixelSize={14} // Switched to 14 to prevent 24px bar overflow
            />
          </button>

          <button
            onClicked={() =>
              app.toggle_window(`notification-center-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button", "notification-button"]}
            valign={Gtk.Align.CENTER}
            heightRequest={24}
          >
            <image
              iconName="preferences-system-notifications-symbolic"
              pixelSize={14}
            />
          </button>

          <Battery />
        </box>
      </centerbox>
    </window>
  );
}
