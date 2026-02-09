import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import { createPoll } from "ags/time";

export default function Clock({
  format = "%I:%M %p %m/%d",
  gdkmonitor,
}: {
  format?: string;
  gdkmonitor: Gdk.Monitor;
}) {
  const time = createPoll("", 1000, () => {
    return GLib.DateTime.new_now_local().format(format) || "00:00";
  });

  return (
    <box cssClasses={["clock"]} heightRequest={24} valign={Gtk.Align.CENTER}>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label={time} />
      </box>
    </box>
  );
}
