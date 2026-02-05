import app from "ags/gtk4/app"
import Astal from "gi://Astal?version=4.0"
import Gdk from "gi://Gdk?version=4.0"
import Gtk from "gi://Gtk?version=4.0"
import { onCleanup } from "ags"
import Workspaces from "./Widgets/Workspaces"
import Clock from "./Widgets/Clock"
import Tray from "./Widgets/Tray"
import Wireless from "./Widgets/wireless"
import AudioOutput from "./Widgets/Audio"
import Battery from "./Widgets/Battry"

export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let win: Astal.Window
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  onCleanup(() => { win.destroy() })

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
      <centerbox>
        <box $type="start">
          <Workspaces />
          
          <button 
            $={(self) => {
              self.connect("clicked", () => {
                // MATCHES the name in SettingsWindow
                app.toggle_window(`settings-window-${gdkmonitor.connector}`)
              })
            }}
            name="settings-button"
          >
            <Gtk.Image iconName="emblem-system-symbolic" />
          </button>
          
        </box>
        <box $type="center">
          <Clock />
        </box>
        <box $type="end">
          <Tray />
          <Wireless />
          <AudioOutput />
          <Battery />
        </box>
      </centerbox>
    </window>
  )
}