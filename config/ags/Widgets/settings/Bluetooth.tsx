import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Bluetooth from "gi://AstalBluetooth";
import { onCleanup } from "ags";
class Variable<T> {
  private value: T;
  private subscribers: Array<(value: T) => void> = [];

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  set(newValue: T) {
    this.value = newValue;
    this.subscribers.forEach((callback) => callback(this.value));
  }

  subscribe(callback: (value: T) => void) {
    this.subscribers.push(callback);
    callback(this.value);
    return () => {
      this.subscribers = this.subscribers.filter((sub) => sub !== callback);
    };
  }
}

export default function BluetoothPage() {
  const bt = Bluetooth.get_default();

  const devices = new Variable<Bluetooth.Device[]>(bt.get_devices() || []);
  const isScanning = new Variable(bt.adapter?.discovering ?? false);
  const isPowered = new Variable(bt.adapter?.powered ?? false);
  const signalIds: number[] = [];
  const adapterSignalIds: number[] = [];
  let scanTimeoutId: number | null = null;

  const sync = () => {
    const allDevices = bt.get_devices() || [];
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

    const filtered = allDevices.filter((dev) => {
      if (dev.paired) return true;
      const name = dev.alias || dev.name;
      if (!name || name.trim().length === 0 || macRegex.test(name))
        return false;
      if (name.includes("LE-") && !dev.paired) return false;
      return true;
    });

    const sorted = filtered.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.paired !== b.paired) return a.paired ? -1 : 1;
      return (a.alias || "").localeCompare(b.alias || "");
    });

    devices.set(sorted);
  };

  signalIds.push(bt.connect("device-added", sync));
  signalIds.push(bt.connect("device-removed", sync));

  const setupAdapter = () => {
    if (!bt.adapter) return;
    isPowered.set(bt.adapter.powered);
    isScanning.set(bt.adapter.discovering);
    adapterSignalIds.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (e) {}
    });
    adapterSignalIds.length = 0;

    adapterSignalIds.push(
      bt.adapter.connect("notify::powered", () =>
        isPowered.set(bt.adapter.powered),
      ),
    );
    adapterSignalIds.push(
      bt.adapter.connect("notify::discovering", () =>
        isScanning.set(bt.adapter.discovering),
      ),
    );
  };

  setupAdapter();
  signalIds.push(bt.connect("notify::adapter", setupAdapter));
  onCleanup(() => {
    if (scanTimeoutId !== null) {
      GLib.source_remove(scanTimeoutId);
      scanTimeoutId = null;
    }
    signalIds.forEach((id) => {
      try {
        bt.disconnect(id);
      } catch (e) {
        console.error("Failed to disconnect bluetooth signal:", e);
      }
    });
    adapterSignalIds.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (e) {
        console.error("Failed to disconnect adapter signal:", e);
      }
    });
  });

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
      vexpand={true}
    >
      <Gtk.Label label="Bluetooth" xalign={0} cssClasses={["page-title"]} />

      {/* ADAPTER CONTROLS */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={16}
      >
        <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
          <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
            <Gtk.Label
              label="Bluetooth Power"
              xalign={0}
              cssClasses={["section-title"]}
            />
            <Gtk.Label
              $={(self: any) => {
                const unsub = isPowered.subscribe((p) =>
                  self.set_label(
                    p ? "Radio is active" : "Radio is powered off",
                  ),
                );
                self.connect("destroy", unsub);
              }}
              xalign={0}
              cssClasses={["dim-label"]}
            />
          </Gtk.Box>
          <Gtk.Switch
            valign={Gtk.Align.CENTER}
            $={(self: any) => {
              const unsub = isPowered.subscribe((p) => self.set_active(p));
              const connId = self.connect(
                "state-set",
                (_: any, state: boolean) => {
                  if (bt.adapter) bt.adapter.set_powered(state);
                  return true;
                },
              );
              self.connect("destroy", () => {
                unsub();
                self.disconnect(connId);
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>
      <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
        <Gtk.Label
          label="Devices"
          xalign={0}
          cssClasses={["section-title"]}
          hexpand
        />
        <Gtk.Spinner
          $={(self: any) => {
            const unsub = isScanning.subscribe((s) => {
              self.set_visible(s);
              s ? self.start() : self.stop();
            });
            self.connect("destroy", unsub);
          }}
        />
        <Gtk.Button
          iconName="view-refresh-symbolic"
          cssClasses={["icon-button"]}
          onClicked={() => {
            if (bt.adapter) {
              if (scanTimeoutId !== null) {
                GLib.source_remove(scanTimeoutId);
              }
              bt.adapter.start_discovery();
              scanTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                10000,
                () => {
                  if (bt.adapter) {
                    bt.adapter.stop_discovery();
                  }
                  scanTimeoutId = null;
                  return false;
                },
              );
            }
          }}
          $={(self: any) => {
            const unsub = isScanning.subscribe((s) => self.set_sensitive(!s));
            self.connect("destroy", unsub);
          }}
        />
      </Gtk.Box>
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={4}
        vexpand={true}
        $={(self: any) => {
          const unsub = devices.subscribe((list) => {
            let child = self.get_first_child();
            while (child) {
              const next = child.get_next_sibling();
              self.remove(child);
              if (typeof child.destroy === "function") {
                child.destroy();
              }
              child = next;
            }

            const createRow = (dev: Bluetooth.Device) => {
              const row = new Gtk.Box({
                spacing: 12,
                cssClasses: ["bt-row"],
              });
              const deviceSignalIds: number[] = [];

              const updateStatus = () => {
                if (dev.connected) row.add_css_class("bt-connected");
                else row.remove_css_class("bt-connected");
              };
              deviceSignalIds.push(
                dev.connect("notify::connected", updateStatus),
              );
              updateStatus();

              const icon = new Gtk.Image({
                iconName: (dev.icon_name || "bluetooth") + "-symbolic",
              });

              const info = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                hexpand: true,
                valign: Gtk.Align.CENTER,
              });

              const nameLabel = new Gtk.Label({
                label: dev.alias || dev.name || "Unknown",
                xalign: 0,
                cssClasses: ["bt-device-name"],
              });

              const pill = new Gtk.Label({
                label: "CONNECTED",
                cssClasses: ["bt-status-pill"],
              });

              const nameBox = new Gtk.Box({ spacing: 8 });
              nameBox.append(nameLabel);
              nameBox.append(pill);

              const updatePillVisibility = () => {
                pill.set_visible(dev.connected);
                if (dev.connected) nameLabel.add_css_class("bt-label-active");
                else nameLabel.remove_css_class("bt-label-active");
              };
              deviceSignalIds.push(
                dev.connect("notify::connected", updatePillVisibility),
              );
              updatePillVisibility();

              info.append(nameBox);

              const connectBtn = new Gtk.Button({
                label: dev.connected ? "Disconnect" : "Connect",
                cssClasses: ["bt-connect-btn"],
                valign: Gtk.Align.CENTER,
              });
              deviceSignalIds.push(
                connectBtn.connect("clicked", () => {
                  if (dev.connected) {
                    dev.disconnect_device(() => sync());
                  } else {
                    if (!dev.paired) dev.pair();
                    dev.set_trusted(true);
                    dev.connect_device(() => sync());
                  }
                }),
              );

              row.append(icon);
              row.append(info);

              if (dev.paired) {
                const forgetBtn = new Gtk.Button({
                  iconName: "edit-delete-symbolic",
                  cssClasses: ["bt-icon-btn", "bt-danger"],
                  valign: Gtk.Align.CENTER,
                });
                deviceSignalIds.push(
                  forgetBtn.connect("clicked", () =>
                    bt.adapter?.remove_device(dev),
                  ),
                );
                row.append(forgetBtn);
              }
              row.append(connectBtn);
              row.connect("destroy", () => {
                deviceSignalIds.forEach((id) => {
                  try {
                    if (id && typeof dev.disconnect === "function") {
                      dev.disconnect(id);
                    }
                  } catch (e) {}
                });
              });

              return row;
            };

            const paired = list.filter((d) => d.paired);
            const available = list.filter((d) => !d.paired);

            if (paired.length > 0) {
              self.append(
                new Gtk.Label({
                  label: "Paired Devices",
                  xalign: 0,
                  cssClasses: ["section-title"],
                  margin_bottom: 8,
                }),
              );
              paired.forEach((d) => self.append(createRow(d)));
            }
            if (available.length > 0) {
              self.append(
                new Gtk.Label({
                  label: "Available",
                  xalign: 0,
                  cssClasses: ["section-title"],
                  margin_top: 16,
                  margin_bottom: 8,
                }),
              );
              available.forEach((d) => self.append(createRow(d)));
            }
          });
          self.connect("destroy", unsub);
        }}
      />
    </Gtk.Box>
  );
}
