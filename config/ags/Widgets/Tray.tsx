import Gtk from "gi://Gtk?version=4.0";
import AstalTray from "gi://AstalTray";
import { For, createBinding } from "ags";

export default function Tray() {
  const tray = AstalTray.get_default();
  const items = createBinding(tray, "items");

  const init = (btn: Gtk.MenuButton, item: AstalTray.TrayItem) => {
    btn.menuModel = item.menuModel;
    btn.insert_action_group("dbusmenu", item.actionGroup);

    // Force the internal popover to be as "flat" as possible
    const popover = btn.get_popover();
    if (popover) {
      popover.has_arrow = false; // Removes the little triangle/arrow
      popover.cascade_popdown = true;
      // This helps remove extra internal padding/margins
      popover.margin_bottom = 0;
      popover.margin_top = 0;
      popover.margin_start = 0;
      popover.margin_end = 0;
    }

    item.connect("notify::action-group", () => {
      btn.insert_action_group("dbusmenu", item.actionGroup);
    });
  };

  return (
    <box cssClasses={["tray"]} valign={Gtk.Align.CENTER}>
      <For each={items}>
        {(item) => (
          <menubutton
            $={(self) => init(self, item)}
            cssClasses={["tray-item"]}
            heightRequest={24}
            valign={Gtk.Align.CENTER}
          >
            <image gicon={createBinding(item, "gicon")} />
          </menubutton>
        )}
      </For>
    </box>
  );
}
