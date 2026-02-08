import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

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

/**
 * TRULY ASYNC EXECUTION
 * This prevents the UI from freezing by running commands in a subprocess
 */
async function execAsync(cmd: string): Promise<string> {
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  });
  const argv = GLib.shell_parse_argv(cmd)[1];
  const proc = launcher.spawnv(argv);
  return new Promise((resolve, reject) => {
    proc.communicate_utf8_async(null, null, (p, res) => {
      try {
        const [_, stdout, stderr] = p!.communicate_utf8_finish(res);
        if (stdout) resolve(stripAnsi(stdout.trim()));
        else resolve("");
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Keep sync only for very fast, local checks like getting the device name
function execSync(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success && stdout) {
      return stripAnsi(new TextDecoder().decode(stdout).trim());
    }
  } catch (err) {
    console.error(`Failed to execute: ${cmd}`, err);
  }
  return "";
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

export default function NetworkPage() {
  const device = getWifiDevice();
  const networks = new Variable<WifiNetwork[]>([]);
  const isScanning = new Variable(false);
  const expandedNetwork = new Variable<string>("");

  const refreshNetworks = async () => {
    if (isScanning.get()) return;
    isScanning.set(true);

    try {
      await execAsync(`iwctl station ${device} scan`);

      // Non-blocking wait
      await new Promise((resolve) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
          resolve(null);
          return GLib.SOURCE_REMOVE;
        }),
      );

      const output = await execAsync(`iwctl station ${device} get-networks`);
      const lines = output.split("\n");
      const foundNetworks: WifiNetwork[] = [];

      for (const line of lines) {
        if (
          line.includes("Network name") ||
          line.includes("----") ||
          line.trim() === ""
        )
          continue;

        const connected = line.trim().startsWith(">");
        const cleanLine = line.replace(">", "").trim();
        const parts = cleanLine.split(/\s{2,}/);

        if (parts.length >= 2) {
          foundNetworks.push({
            name: parts[0].trim(),
            connected,
            security: parts[1]?.trim() || "unknown",
            signal: parts[2]?.trim() || "****",
          });
        }
      }

      foundNetworks.sort((a, b) =>
        a.connected === b.connected ? 0 : a.connected ? -1 : 1,
      );
      networks.set(foundNetworks);
    } catch (e) {
      console.error("WiFi Scan Error:", e);
    } finally {
      isScanning.set(false);
    }
  };

  const handleConnect = async (network: WifiNetwork, password?: string) => {
    expandedNetwork.set("");
    const cmd = password
      ? `iwctl station ${device} connect "${network.name}" --passphrase "${password}"`
      : `iwctl station ${device} connect "${network.name}"`;

    await execAsync(cmd);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
      refreshNetworks();
      return GLib.SOURCE_REMOVE;
    });
  };

  const disconnectNetwork = async () => {
    await execAsync(`iwctl station ${device} disconnect`);
    refreshNetworks();
  };

  const handleNetworkClick = (network: WifiNetwork) => {
    if (network.connected) {
      disconnectNetwork();
      return;
    }

    if (network.security === "open") {
      handleConnect(network);
    } else {
      expandedNetwork.set(network.name);
    }
  };

  refreshNetworks();

  return (
    <Gtk.Box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={24}
      cssClasses={["page-container"]}
    >
      <Gtk.Label label="Network" xalign={0} cssClasses={["page-title"]} />

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
            onClicked={() => refreshNetworks()}
            $={(self: any) => {
              isScanning.subscribe((scanning) => {
                self.set_sensitive(!scanning);
                if (scanning) self.add_css_class("scanning");
                else self.remove_css_class("scanning");
              });
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

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
                    marginTop: 8, // FIXED: Changed from padding_top to marginTop
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
                networkList.forEach((network) =>
                  self.append(createNetworkItem(network)),
                );
              });
            }}
          />
        </Gtk.ScrolledWindow>
      </Gtk.Box>
    </Gtk.Box>
  );
}
