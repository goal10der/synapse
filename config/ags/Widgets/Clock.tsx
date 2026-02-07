import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib?version=2.0";
import { createPoll } from "ags/time";

export default function Clock({ format = "%I:%M %p %m/%d" } = {}) {
  // 1. Only poll for the string value
  const time = createPoll("", 1000, () => {
    return GLib.DateTime.new_now_local().format(format)!;
  });

  return (
    <menubutton cssClasses={["clock"]}>
      {/* 2. The label now receives a string-based binding */}
      <label label={time} />
    </menubutton>
  );
}
