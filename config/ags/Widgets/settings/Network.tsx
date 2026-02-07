import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";

// Simple Variable class for state management
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
  }
}

// Strip ANSI escape codes
function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

function execSync(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success && stdout) {
      const output = new TextDecoder().decode(stdout).trim();
      return stripAnsi(output);
    }
  } catch (err) {
    console.error(`Failed to execute: ${cmd}`, err);
  }
  return "";
}

function execAsync(cmd: string): void {
  try {
    GLib.spawn_command_line_async(cmd);
  } catch (err) {
    console.error(`Failed to execute: ${cmd}`, err);
  }
}

interface WifiNetwork {
  name: string;
  connected: boolean;
  security: string;
  signal: string;
}

function getWifiDevice(): string {
  const output = execSync("iwctl device list");
  const lines = output.split("\n");

  for (const line of lines) {
    if (line.includes("station")) {
      const parts = line.trim().split(/\s+/);
      for (const part of parts) {
        if (part.match(/^(wlan|wlp|wlo)\w*/)) {
          return part;
        }
      }
    }
  }
  return "wlan0";
}

function scanNetworks(device: string): WifiNetwork[] {
  execSync(`iwctl station ${device} scan`);
  GLib.usleep(1000000);

  const output = execSync(`iwctl station ${device} get-networks`);
  const lines = output.split("\n");
  const networks: WifiNetwork[] = [];

  for (const line of lines) {
    if (
      line.includes("Network name") ||
      line.includes("Available networks") ||
      line.trim() === "" ||
      line.includes("----") ||
      line.includes("No networks")
    ) {
      continue;
    }

    const connected = line.trim().startsWith(">");
    const cleanLine = line.replace(">", "").trim();
    const parts = cleanLine.split(/\s{2,}/);

    if (parts.length >= 2) {
      networks.push({
        name: parts[0].trim(),
        connected,
        security: parts[1]?.trim() || "unknown",
        signal: parts[2]?.trim() || "****",
      });
    }
  }

  return networks;
}

export default function NetworkPage() {
  const device = getWifiDevice();

  const networks = new Variable<WifiNetwork[]>([]);
  const isScanning = new Variable(false);
  const expandedNetwork = new Variable<string>("");

  const refreshNetworks = () => {
    isScanning.set(true);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      const foundNetworks = scanNetworks(device);
      // Sort connected to top
      foundNetworks.sort((a, b) =>
        a.connected === b.connected ? 0 : a.connected ? -1 : 1,
      );
      networks.set(foundNetworks);
      isScanning.set(false);
      return GLib.SOURCE_REMOVE;
    });
  };

  const connectToNetwork = (ssid: string, password?: string) => {
    if (password) {
      execAsync(
        `iwctl station ${device} connect "${ssid}" --passphrase "${password}"`,
      );
    } else {
      execAsync(`iwctl station ${device} connect "${ssid}"`);
    }
  };

  const disconnectNetwork = () => {
    execAsync(`iwctl station ${device} disconnect`);
  };

  const handleNetworkClick = (network: WifiNetwork) => {
    if (network.connected) {
      disconnectNetwork();
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        refreshNetworks();
        return GLib.SOURCE_REMOVE;
      });
      return;
    }

    if (network.security === "open") {
      connectToNetwork(network.name);
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        refreshNetworks();
        return GLib.SOURCE_REMOVE;
      });
    } else {
      expandedNetwork.set(network.name);
    }
  };

  const handleConnect = (network: WifiNetwork, password: string) => {
    connectToNetwork(network.name, password);
    expandedNetwork.set("");
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
      refreshNetworks();
      return GLib.SOURCE_REMOVE;
    });
  };

  // Initial scan
  refreshNetworks();

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
    >
      <Gtk.Label label="Network" xalign={0} cssClasses={["page-title"]} />

      {/* WiFi Status */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={16}
      >
        <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
          <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
            <Gtk.Label
              label="WiFi Device"
              xalign={0}
              cssClasses={["section-title"]}
            />
            <Gtk.Label label={device} xalign={0} cssClasses={["dim-label"]} />
          </Gtk.Box>
          <Gtk.Button
            iconName="view-refresh-symbolic"
            cssClasses={["icon-button"]}
            onClicked={refreshNetworks}
            $={(self: any) => {
              isScanning.subscribe((scanning) => {
                self.set_sensitive(!scanning);
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Network List */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={16}
      >
        <Gtk.Label
          label="Available Networks"
          xalign={0}
          cssClasses={["section-title"]}
        />

        <Gtk.ScrolledWindow
          heightRequest={400}
          vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
            $={(self: any) => {
              const createNetworkItem = (network: WifiNetwork) => {
                const container = new Gtk.Box({
                  orientation: Gtk.Orientation.VERTICAL,
                  spacing: 0,
                });

                const buttonBox = new Gtk.Box({
                  orientation: Gtk.Orientation.HORIZONTAL,
                  spacing: 12,
                });

                // FIXED ICON LOGIC: Using standard network icons
                buttonBox.append(
                  new Gtk.Image({
                    iconName: network.connected
                      ? "network-wireless-connected-symbolic"
                      : "network-wireless-symbolic",
                  }),
                );

                const ssidLabel = new Gtk.Label({
                  label: network.name,
                  hexpand: true,
                  xalign: 0,
                });
                if (network.connected)
                  ssidLabel.add_css_class("connected-label");
                buttonBox.append(ssidLabel);

                if (network.connected) {
                  buttonBox.append(
                    new Gtk.Label({
                      label: "CONNECTED",
                      cssClasses: ["connected-status-pill"],
                    }),
                  );
                }

                buttonBox.append(
                  new Gtk.Label({
                    label: network.signal,
                    cssClasses: ["dim-label"],
                  }),
                );

                buttonBox.append(
                  new Gtk.Label({
                    label: network.security,
                    cssClasses: ["dim-label"],
                  }),
                );

                const button = new Gtk.Button({
                  child: buttonBox,
                  cssClasses: network.connected
                    ? ["network-item", "connected"]
                    : ["network-item"],
                });

                button.connect("clicked", () => handleNetworkClick(network));
                container.append(button);

                if (network.security !== "open" && !network.connected) {
                  const passwordBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 8,
                    cssClasses: ["network-password-box"],
                  });

                  const passwordEntry = new Gtk.Entry({
                    placeholderText: "Enter password",
                    visibility: false,
                    hexpand: true,
                  });

                  const doConnect = () => {
                    const password = passwordEntry.get_text();
                    if (password) {
                      handleConnect(network, password);
                      passwordEntry.set_text("");
                    }
                  };

                  passwordEntry.connect("activate", doConnect);

                  const connectBtn = new Gtk.Button({
                    label: "Connect",
                    cssClasses: ["primary-button"],
                  });
                  connectBtn.connect("clicked", doConnect);

                  const cancelBtn = new Gtk.Button({
                    label: "Cancel",
                    cssClasses: ["secondary-button"],
                  });
                  cancelBtn.connect("clicked", () => {
                    expandedNetwork.set("");
                    passwordEntry.set_text("");
                  });

                  passwordBox.append(passwordEntry);
                  passwordBox.append(connectBtn);
                  passwordBox.append(cancelBtn);

                  const revealer = new Gtk.Revealer({
                    child: passwordBox,
                    transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
                  });

                  expandedNetwork.subscribe((expanded) => {
                    revealer.set_reveal_child(expanded === network.name);
                  });

                  container.append(revealer);
                }

                return container;
              };

              networks.subscribe((networkList) => {
                let child = self.get_first_child();
                while (child) {
                  const next = child.get_next_sibling();
                  self.remove(child);
                  child = next;
                }

                networkList.forEach((network) => {
                  const item = createNetworkItem(network);
                  self.append(item);
                });
              });
            }}
          />
        </Gtk.ScrolledWindow>
      </Gtk.Box>

      {/* IWD Info */}
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["settings-card"]}
        spacing={10}
      >
        <Gtk.Label
          label="IWD Status"
          xalign={0}
          cssClasses={["section-title"]}
        />
        <Gtk.Label
          label={`Service Status: ${execSync("systemctl is-active iwd")}`}
          xalign={0}
          cssClasses={["dim-label"]}
        />
      </Gtk.Box>
    </Gtk.Box>
  );
}
