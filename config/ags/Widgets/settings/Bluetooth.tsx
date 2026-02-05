import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"
import Bluetooth from "gi://AstalBluetooth"

// --- STATE MANAGEMENT CLASS ---
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
        this.subscribers.forEach(callback => callback(this.value));
    }

    subscribe(callback: (value: T) => void) {
        this.subscribers.push(callback);
        callback(this.value);
    }
}

// --- BLUETOOTH PAGE COMPONENT ---
export default function BluetoothPage() {
    const bt = Bluetooth.get_default();
    
    // Initialize Variables
    const devices = new Variable<Bluetooth.Device[]>(bt.get_devices() || []);
    const isScanning = new Variable(bt.adapter?.discovering ?? false);
    const isPowered = new Variable(bt.adapter?.powered ?? false);

    // Sync function to refresh device list
 const sync = () => {
    const allDevices = bt.get_devices() || [];
    
    // Regular Expression to detect MAC addresses (e.g., AA:BB:CC:11:22:33)
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

    const filtered = allDevices.filter(dev => {
        // 1. Always keep devices we already paired with
        if (dev.paired) return true;

        const name = dev.alias || dev.name;

        // 2. Remove if name is missing or is just an empty string
        if (!name || name.trim().length === 0) return false;

        // 3. Remove if the name is just the MAC address
        if (macRegex.test(name)) return false;

        // 4. Filter out common "hidden" BLE devices that don't offer services
        // Some devices exist but aren't actually connectable gadgets
        if (name.includes("LE-") && !dev.paired) return false;

        return true;
    });

    // Sort: Connected > Paired > Alphabetical
    const sorted = filtered.sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        if (a.paired !== b.paired) return a.paired ? -1 : 1;
        return (a.alias || "").localeCompare(b.alias || "");
    });

    devices.set(sorted);
};

    // Listen for global device changes
    bt.connect("device-added", sync);
    bt.connect("device-removed", sync);
    
    // Handle Adapter-specific signals
    const setupAdapter = () => {
        if (!bt.adapter) return;
        
        isPowered.set(bt.adapter.powered);
        isScanning.set(bt.adapter.discovering);

        bt.adapter.connect("notify::powered", () => isPowered.set(bt.adapter.powered));
        bt.adapter.connect("notify::discovering", () => isScanning.set(bt.adapter.discovering));
    };

    setupAdapter();
    bt.connect("notify::adapter", setupAdapter);

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={24} cssClasses={["page-container"]}>
            <Gtk.Label label="Bluetooth" xalign={0} cssClasses={["page-title"]} />
            
            {/* ADAPTER CONTROLS */}
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={["settings-card"]} spacing={16}>
                {/* POWER TOGGLE */}
                <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
                        <Gtk.Label label="Bluetooth Power" xalign={0} cssClasses={["section-title"]} />
                        <Gtk.Label 
                            $={(self: any) => isPowered.subscribe(p => {
                                self.set_label(p ? "Radio is active" : "Radio is powered off");
                            })}
                            xalign={0} cssClasses={["dim-label"]}
                        />
                    </Gtk.Box>
                    <Gtk.Switch 
                        valign={Gtk.Align.CENTER}
                        $={(self: any) => {
                            isPowered.subscribe(p => self.set_active(p));
                            self.connect("state-set", (_: any, state: boolean) => {
                                if (bt.adapter) bt.adapter.set_powered(state);
                                return true; 
                            });
                        }}
                    />
                </Gtk.Box>

                <Gtk.Separator orientation={Gtk.Orientation.HORIZONTAL} />

                {/* VISIBILITY TOGGLE */}
                <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
                        <Gtk.Label label="Visible to Others" xalign={0} cssClasses={["section-title"]} />
                        <Gtk.Label 
                            $={(self: any) => {
                                const update = () => {
                                    const disc = bt.adapter?.discoverable;
                                    self.set_label(disc ? "Nearby devices can see your PC" : "Hidden from others");
                                };
                                bt.adapter?.connect("notify::discoverable", update);
                                update();
                            }}
                            xalign={0} cssClasses={["dim-label"]}
                        />
                    </Gtk.Box>
                    <Gtk.Switch 
                        valign={Gtk.Align.CENTER}
                        $={(self: any) => {
                            const update = () => self.set_active(bt.adapter?.discoverable || false);
                            bt.adapter?.connect("notify::discoverable", update);
                            update();

                            self.connect("state-set", (_: any, state: boolean) => {
                                if (bt.adapter) bt.adapter.set_discoverable(state);
                                return true;
                            });

                            // Disable visibility switch if Bluetooth is off
                            isPowered.subscribe(p => self.set_sensitive(p));
                        }}
                    />
                </Gtk.Box>
            </Gtk.Box>

            {/* SCANNING HEADER */}
            <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
                <Gtk.Label label="Devices" xalign={0} cssClasses={["section-title"]} hexpand />
                <Gtk.Spinner 
                    $={(self: any) => isScanning.subscribe(s => {
                        self.set_visible(s);
                        s ? self.start() : self.stop();
                    })} 
                />
                <Gtk.Button
                    iconName="view-refresh-symbolic"
                    cssClasses={["icon-button"]}
                    onClicked={() => bt.adapter?.start_discovery()}
                    $={(self: any) => isScanning.subscribe(s => self.set_sensitive(!s))}
                />
            </Gtk.Box>

            {/* SCROLLABLE DEVICE LIST */}
            <Gtk.ScrolledWindow heightRequest={400} vexpand vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={12}
                    $={(self: any) => {
                        devices.subscribe(list => {
                            // Clear existing list
                            let child = self.get_first_child();
                            while (child) {
                                const next = child.get_next_sibling();
                                self.remove(child);
                                child = next;
                            }

                            const createRow = (dev: Bluetooth.Device) => {
                                const row = new Gtk.Box({ spacing: 12, cssClasses: ["network-item"] });
                                
                                const icon = new Gtk.Image({ 
                                    iconName: (dev.icon_name || "bluetooth") + "-symbolic" 
                                });

                                const info = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true });
                                const nameLabel = new Gtk.Label({ label: dev.alias || dev.name || "Unknown", xalign: 0, cssClasses: ["device-name"] });
                                const statusLabel = new Gtk.Label({ 
                                    label: dev.connected ? "Connected" : (dev.paired ? "Paired" : "Available"),
                                    xalign: 0, cssClasses: ["dim-label", "small-text"] 
                                });
                                
                                // Internal listener for connection changes
                                dev.connect("notify::connected", () => {
                                    statusLabel.set_label(dev.connected ? "Connected" : (dev.paired ? "Paired" : "Available"));
                                    connectBtn.set_label(dev.connected ? "Disconnect" : "Connect");
                                    connectBtn.set_css_classes(dev.connected ? ["secondary-button"] : ["primary-button"]);
                                });

                                info.append(nameLabel);
                                info.append(statusLabel);

                                const connectBtn = new Gtk.Button({
                                    label: dev.connected ? "Disconnect" : "Connect",
                                    cssClasses: dev.connected ? ["secondary-button"] : ["primary-button"],
                                    valign: Gtk.Align.CENTER
                                });

connectBtn.connect("clicked", () => {
    if (dev.connected) {
        console.log(`[Bluetooth] Disconnecting from ${dev.alias}`);
        try {
            // Disconnect usually follows the same pattern as connect
            dev.disconnect_device(() => {
                console.log("[Bluetooth] Disconnected");
                sync();
            });
        } catch (e) {
            console.error(`[Bluetooth] Disconnect failed: ${e}`);
        }
        return;
    }

    try {
        if (bt.adapter) {
            bt.adapter.set_pairable(true);
            bt.adapter.set_discoverable(true);
        }

        // 1. Pair (Synchronous in your version)
        if (!dev.paired) {
            console.log(`[Bluetooth] Pairing with ${dev.alias}...`);
            dev.pair(); 
            console.log(`[Bluetooth] Pair command finished`);
        }

        // 2. Trust
        dev.set_trusted(true);

        // 3. Connect (Asynchronous, requires at least 1 argument: the callback)
        console.log(`[Bluetooth] Connecting to ${dev.alias}...`);
        dev.connect_device((_obj, res) => {
            try {
                // We call finish to catch any DBus errors (like Auth Failed)
                dev.connect_device_finish(res);
                console.log(`[Bluetooth] Successfully connected to ${dev.alias}`);
            } catch (e) {
                console.error(`[Bluetooth] Connection finished with error: ${e}`);
            }
            sync(); // Always sync at the end
        });

    } catch (e) {
        console.error(`[Bluetooth] Logic error: ${e}`);
    }
});

                                row.append(icon);
                                row.append(info);

                                if (dev.paired) {
                                    const forgetBtn = new Gtk.Button({
                                        iconName: "edit-delete-symbolic",
                                        cssClasses: ["icon-button", "danger-button"],
                                        valign: Gtk.Align.CENTER
                                    });
                                    forgetBtn.connect("clicked", () => bt.adapter?.remove_device(dev));
                                    row.append(forgetBtn);
                                }

                                row.append(connectBtn);
                                return row;
                            };

                            // Categorize and Render
                            const paired = list.filter(d => d.paired);
                            const available = list.filter(d => !d.paired);

                            if (paired.length > 0) {
                                self.append(new Gtk.Label({ label: "Paired Devices", xalign: 0, cssClasses: ["dim-label"] }));
                                paired.forEach(d => self.append(createRow(d)));
                            }

                            if (available.length > 0) {
                                self.append(new Gtk.Label({ label: "Available", xalign: 0, cssClasses: ["dim-label"], margin_top: 16 }));
                                available.forEach(d => self.append(createRow(d)));
                            }

                            if (list.length === 0) {
                                self.append(new Gtk.Label({ label: "No devices found", margin_top: 24, cssClasses: ["dim-label"] }));
                            }
                        });
                    }}
                />
            </Gtk.ScrolledWindow>
        </Gtk.Box>
    );
}