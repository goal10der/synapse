import Gtk from "gi://Gtk?version=4.0";
import AstalTray from "gi://AstalTray";
import { For, createBinding } from "ags";

export default function Tray() {
  const tray = AstalTray.get_default();
  const items = createBinding(tray, "items");

  const init = (btn: Gtk.MenuButton, item: AstalTray.TrayItem) => {
    btn.menuModel = item.menuModel;
    btn.insert_action_group("dbusmenu", item.actionGroup);
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
