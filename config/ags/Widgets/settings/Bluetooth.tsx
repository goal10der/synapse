import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Bluetooth from "gi://AstalBluetooth";
import { onCleanup } from "ags";
import { Variable } from "../../utils/Variable";

export default function BluetoothPage() {
  const bt = Bluetooth.get_default();

  const devices = new Variable<Bluetooth.Device[]>([]);
  const isScanning = new Variable(bt.adapter?.discovering ?? false);
  const isPowered = new Variable(bt.adapter?.powered ?? false);

  const btSignalIds: number[] = [];
  const adapterSignalIds: number[] = [];
  let scanTimeoutId: number | null = null;

  const MAC_REGEX = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  const sync = () => {
    const all = bt.get_devices() ?? [];
    const filtered = all.filter((dev) => {
      if (dev.paired) return true;
      const name = dev.alias || dev.name;
      if (!name || !name.trim() || MAC_REGEX.test(name)) return false;
      if (name.includes("LE-") && !dev.paired) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.paired !== b.paired) return a.paired ? -1 : 1;
      return (a.alias || "").localeCompare(b.alias || "");
    });
    devices.set(filtered);
  };

  btSignalIds.push(bt.connect("device-added", sync));
  btSignalIds.push(bt.connect("device-removed", sync));

  const setupAdapter = () => {
    if (!bt.adapter) return;
    isPowered.set(bt.adapter.powered);
    isScanning.set(bt.adapter.discovering);

    adapterSignalIds.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (_) {}
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
  sync();
  btSignalIds.push(bt.connect("notify::adapter", setupAdapter));

  onCleanup(() => {
    if (scanTimeoutId !== null) {
      GLib.source_remove(scanTimeoutId);
      scanTimeoutId = null;
    }
    btSignalIds.forEach((id) => {
      try {
        bt.disconnect(id);
      } catch (_) {}
    });
    adapterSignalIds.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (_) {}
    });
  });

  const createRow = (dev: Bluetooth.Device): Gtk.Box => {
    const row = new Gtk.Box({ spacing: 12, cssClasses: ["bt-row"] });
    const devSignals: number[] = [];

    const updateConnected = () => {
      if (dev.connected) row.add_css_class("bt-connected");
      else row.remove_css_class("bt-connected");
    };
    devSignals.push(dev.connect("notify::connected", updateConnected));
    updateConnected();

    row.append(
      new Gtk.Image({ iconName: (dev.icon_name || "bluetooth") + "-symbolic" }),
    );

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

    const updatePill = () => {
      pill.set_visible(dev.connected);
      if (dev.connected) nameLabel.add_css_class("bt-label-active");
      else nameLabel.remove_css_class("bt-label-active");
    };
    devSignals.push(dev.connect("notify::connected", updatePill));
    updatePill();

    const info = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    info.append(nameBox);
    row.append(info);

    if (dev.paired) {
      const forgetBtn = new Gtk.Button({
        iconName: "edit-delete-symbolic",
        cssClasses: ["bt-icon-btn", "bt-danger"],
        valign: Gtk.Align.CENTER,
      });
      devSignals.push(
        forgetBtn.connect("clicked", () => bt.adapter?.remove_device(dev)),
      );
      row.append(forgetBtn);
    }

    const connectBtn = new Gtk.Button({
      label: dev.connected ? "Disconnect" : "Connect",
      cssClasses: ["bt-connect-btn"],
      valign: Gtk.Align.CENTER,
    });
    devSignals.push(
      dev.connect("notify::connected", () => {
        connectBtn.label = dev.connected ? "Disconnect" : "Connect";
      }),
    );
    devSignals.push(
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
    row.append(connectBtn);

    row.connect("destroy", () => {
      devSignals.forEach((id) => {
        try {
          dev.disconnect(id);
        } catch (_) {}
      });
    });
    return row;
  };

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
      vexpand
    >
      <Gtk.Label label="Bluetooth" xalign={0} cssClasses={["page-title"]} />

      {/* Power toggle */}
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
              const id = self.connect("state-set", (_: any, state: boolean) => {
                bt.adapter?.set_powered(state);
                return true;
              });
              self.connect("destroy", () => {
                unsub();
                self.disconnect(id);
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Scan header */}
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
          $={(self: any) => {
            const unsub = isScanning.subscribe((s) => self.set_sensitive(!s));
            self.connect("destroy", unsub);
          }}
          onClicked={() => {
            if (!bt.adapter) return;
            if (scanTimeoutId !== null) GLib.source_remove(scanTimeoutId);
            bt.adapter.start_discovery();
            scanTimeoutId = GLib.timeout_add(
              GLib.PRIORITY_DEFAULT,
              10000,
              () => {
                bt.adapter?.stop_discovery();
                scanTimeoutId = null;
                return false;
              },
            );
          }}
        />
      </Gtk.Box>

      {/* Device list */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={4}
        vexpand
        $={(self: any) => {
          const unsub = devices.subscribe((list) => {
            // Remove all children — no .destroy() needed, remove() is sufficient
            let child = self.get_first_child();
            while (child) {
              const next = child.get_next_sibling();
              self.remove(child);
              child = next;
            }

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
