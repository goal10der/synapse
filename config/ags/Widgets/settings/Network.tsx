import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { Variable } from "../../utils/Variable";

// ── types ─────────────────────────────────────────────────────────────────────

type Backend = "nmcli" | "iwctl";

interface WifiNetwork {
  name: string;
  connected: boolean;
  security: string;
  signal: string;
}

// ── shell helpers ─────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

function execSync(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success && stdout)
      return stripAnsi(new TextDecoder().decode(stdout).trim());
  } catch (_) {}
  return "";
}

async function execAsync(cmd: string): Promise<string> {
  try {
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    const argv = GLib.shell_parse_argv(cmd)[1];
    const proc = launcher.spawnv(argv);
    return new Promise((resolve, reject) => {
      proc.communicate_utf8_async(null, null, (p, res) => {
        try {
          const [, stdout] = p!.communicate_utf8_finish(res);
          resolve(stdout ? stripAnsi(stdout.trim()) : "");
        } catch (e) {
          reject(e);
        }
      });
    });
  } catch (_) {
    return "";
  }
}

/** Resolves after `ms` milliseconds without blocking the main loop. */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      resolve();
      return GLib.SOURCE_REMOVE;
    }),
  );

function commandExists(cmd: string): boolean {
  return execSync(`which ${cmd}`) !== "";
}

// ── backend detection ─────────────────────────────────────────────────────────

function detectBackend(): Backend {
  if (commandExists("nmcli")) {
    const state = execSync("nmcli -t -f STATE general");
    if (state && state !== "unmanaged") return "nmcli";
  }
  return "iwctl";
}

// ── nmcli ─────────────────────────────────────────────────────────────────────

function nmcliGetDevice(): string {
  const out = execSync("nmcli -t -f DEVICE,TYPE device");
  for (const line of out.split("\n")) {
    const [device, type] = line.split(":");
    if (type?.trim() === "wifi") return device.trim();
  }
  return "";
}

async function nmcliScanAndList(device: string): Promise<WifiNetwork[]> {
  await execAsync(`nmcli device wifi rescan ifname ${device}`).catch(() => {});
  await delay(1500);

  const out = await execAsync(
    "nmcli -t -f IN-USE,SSID,SECURITY,SIGNAL device wifi list",
  );

  const seen = new Map<string, WifiNetwork>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split(":");
    if (parts.length < 4) continue;
    const connected = parts[0].trim() === "*";
    const name = parts[1].trim();
    const security = parts[2].trim() || "open";
    const signal = parts[3].trim();
    if (!name) continue;
    const existing = seen.get(name);
    if (!existing || Number(signal) > Number(existing.signal))
      seen.set(name, { name, connected, security, signal });
  }

  return [...seen.values()].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      Number(b.signal) - Number(a.signal),
  );
}

async function nmcliConnect(
  device: string,
  network: WifiNetwork,
  password?: string,
): Promise<void> {
  if (password) {
    await execAsync(
      `nmcli device wifi connect "${network.name}" password "${password}" ifname ${device}`,
    );
  } else {
    await execAsync(`nmcli connection up "${network.name}"`);
  }
}

async function nmcliDisconnect(device: string): Promise<void> {
  await execAsync(`nmcli device disconnect ${device}`);
}

// ── iwctl ─────────────────────────────────────────────────────────────────────

function iwctlGetDevice(): string {
  const out = execSync("iwctl device list");
  for (const line of out.split("\n")) {
    if (!line.includes("station")) continue;
    for (const part of line.trim().split(/\s+/)) {
      if (/^(wlan|wlp|wlo)\w*/.test(part)) return part;
    }
  }
  return "wlan0";
}

async function iwctlScanAndList(device: string): Promise<WifiNetwork[]> {
  await execAsync(`iwctl station ${device} scan`);
  await delay(1000);

  const out = await execAsync(`iwctl station ${device} get-networks`);
  const networks: WifiNetwork[] = [];

  for (const line of out.split("\n")) {
    if (line.includes("Network name") || line.includes("----") || !line.trim())
      continue;
    const connected = line.trim().startsWith(">");
    const clean = line.replace(/>/g, "").trim();
    const parts = clean.split(/\s{2,}/);
    if (parts.length >= 2) {
      networks.push({
        name: parts[0].trim(),
        connected,
        security: parts[1]?.trim() || "unknown",
        signal: parts[2]?.trim() || "****",
      });
    }
  }

  return networks.sort((a, b) => Number(b.connected) - Number(a.connected));
}

async function iwctlConnect(
  device: string,
  network: WifiNetwork,
  password?: string,
): Promise<void> {
  const cmd = password
    ? `iwctl station ${device} connect "${network.name}" --passphrase "${password}"`
    : `iwctl station ${device} connect "${network.name}"`;
  await execAsync(cmd);
}

async function iwctlDisconnect(device: string): Promise<void> {
  await execAsync(`iwctl station ${device} disconnect`);
}

// ── component ─────────────────────────────────────────────────────────────────

export default function NetworkPage() {
  const backend = detectBackend();
  const device = backend === "nmcli" ? nmcliGetDevice() : iwctlGetDevice();

  const networks = new Variable<WifiNetwork[]>([]);
  const isScanning = new Variable(false);
  const expandedNetwork = new Variable<string>("");

  const refreshNetworks = async () => {
    if (isScanning.get()) return;
    isScanning.set(true);
    try {
      const list =
        backend === "nmcli"
          ? await nmcliScanAndList(device)
          : await iwctlScanAndList(device);
      networks.set(list);
    } catch (e) {
      console.error("Scan error:", e);
    } finally {
      isScanning.set(false);
    }
  };

  const handleConnect = async (network: WifiNetwork, password?: string) => {
    expandedNetwork.set("");
    try {
      if (backend === "nmcli") await nmcliConnect(device, network, password);
      else await iwctlConnect(device, network, password);
    } catch (e) {
      console.error("Connect error:", e);
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      refreshNetworks();
      return GLib.SOURCE_REMOVE;
    });
  };

  const handleDisconnect = async () => {
    try {
      if (backend === "nmcli") await nmcliDisconnect(device);
      else await iwctlDisconnect(device);
    } catch (e) {
      console.error("Disconnect error:", e);
    }
    refreshNetworks();
  };

  const handleNetworkClick = (network: WifiNetwork) => {
    if (network.connected) {
      handleDisconnect();
    } else if (["open", "--", ""].includes(network.security)) {
      handleConnect(network);
    } else {
      expandedNetwork.set(
        expandedNetwork.get() === network.name ? "" : network.name,
      );
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

      {/* Device info card */}
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
            <Gtk.Label
              label={`${device}  (${backend})`}
              xalign={0}
              cssClasses={["dim-label"]}
            />
          </Gtk.Box>
          <Gtk.Button
            iconName="view-refresh-symbolic"
            cssClasses={["icon-button"]}
            onClicked={() => refreshNetworks()}
            $={(self: any) => {
              const unsub = isScanning.subscribe((scanning) => {
                self.set_sensitive(!scanning);
                scanning
                  ? self.add_css_class("scanning")
                  : self.remove_css_class("scanning");
              });
              self.connect("destroy", unsub);
            }}
          />
        </Gtk.Box>
      </Gtk.Box>

      {/* Network list card */}
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

                if (network.connected)
                  buttonBox.append(
                    new Gtk.Label({
                      label: "CONNECTED",
                      cssClasses: ["connected-status-pill"],
                    }),
                  );

                buttonBox.append(
                  new Gtk.Label({
                    label: network.signal,
                    cssClasses: ["dim-label"],
                    tooltipText: network.security,
                  }),
                );

                const button = new Gtk.Button({
                  child: buttonBox,
                  cssClasses: network.connected
                    ? ["network-item", "connected"]
                    : ["network-item"],
                });
                const clickId = button.connect("clicked", () =>
                  handleNetworkClick(network),
                );
                container.append(button);

                let subUnsub: (() => void) | null = null;
                const isOpen = ["open", "--", ""].includes(network.security);

                if (!isOpen && !network.connected) {
                  const passwordBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 8,
                    marginTop: 8,
                    cssClasses: ["network-password-box"],
                  });
                  const passwordEntry = new Gtk.Entry({
                    placeholderText: "Password",
                    visibility: false,
                    hexpand: true,
                  });
                  const connectBtn = new Gtk.Button({
                    label: "Connect",
                    cssClasses: ["primary-button"],
                  });
                  const cancelBtn = new Gtk.Button({
                    label: "Cancel",
                    cssClasses: ["secondary-button"],
                  });

                  const onConn = () => {
                    if (passwordEntry.text)
                      handleConnect(network, passwordEntry.text);
                  };
                  passwordEntry.connect("activate", onConn);
                  connectBtn.connect("clicked", onConn);
                  cancelBtn.connect("clicked", () => expandedNetwork.set(""));

                  passwordBox.append(passwordEntry);
                  passwordBox.append(connectBtn);
                  passwordBox.append(cancelBtn);

                  const revealer = new Gtk.Revealer({
                    child: passwordBox,
                    transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
                  });

                  subUnsub = expandedNetwork.subscribe((expanded) => {
                    revealer.reveal_child = expanded === network.name;
                  });

                  container.append(revealer);
                }

                container.connect("destroy", () => {
                  if (subUnsub) subUnsub();
                  button.disconnect(clickId);
                });

                return container;
              };

              const networksUnsub = networks.subscribe((networkList) => {
                let child = self.get_first_child();
                while (child) {
                  const next = child.get_next_sibling();
                  self.remove(child);
                  child = next;
                }
                networkList.forEach((n) => self.append(createNetworkItem(n)));
              });

              self.connect("destroy", networksUnsub);
            }}
          />
        </Gtk.ScrolledWindow>
      </Gtk.Box>
    </Gtk.Box>
  );
}
