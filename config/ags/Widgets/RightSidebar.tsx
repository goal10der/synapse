import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import AstalWp from "gi://AstalWp?version=0.1";
import AstalBluetooth from "gi://AstalBluetooth";
import Notifd from "gi://AstalNotifd";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Pango from "gi://Pango";
import { Variable } from "../utils/Variable";
import { editMode, toggleEditMode } from "../State";
import CalendarWidget, { buildDayView } from "./Calendar";

// ── Network helpers (inlined from Network.tsx) ────────────────────────────────

type WifiBackend = "nmcli" | "iwctl";

interface WifiNetwork {
  name: string;
  connected: boolean;
  security: string;
  signal: string;
}

function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

function netExecSync(cmd: string): string {
  try {
    const [ok, out] = GLib.spawn_command_line_sync(cmd);
    if (ok && out) return stripAnsi(new TextDecoder().decode(out).trim());
  } catch (_) {}
  return "";
}

async function netExecAsync(cmd: string): Promise<string> {
  try {
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    const proc = launcher.spawnv(GLib.shell_parse_argv(cmd)[1]);
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

function wifiDetectBackend(): WifiBackend {
  try {
    const [ok, out] = GLib.spawn_command_line_sync("which nmcli");
    if (ok && out && new TextDecoder().decode(out).trim()) {
      const state = netExecSync("nmcli -t -f STATE general");
      if (state && state !== "unmanaged") return "nmcli";
    }
  } catch (_) {}
  return "iwctl";
}

function nmcliGetDevice(): string {
  for (const line of netExecSync("nmcli -t -f DEVICE,TYPE device").split(
    "\n",
  )) {
    const [device, type] = line.split(":");
    if (type?.trim() === "wifi") return device.trim();
  }
  return "";
}

async function nmcliScanAndList(device: string): Promise<WifiNetwork[]> {
  await netExecAsync(`nmcli device wifi rescan ifname ${device}`).catch(
    () => {},
  );
  await new Promise((r) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      r(null);
      return GLib.SOURCE_REMOVE;
    }),
  );
  const out = await netExecAsync(
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
) {
  if (password)
    await netExecAsync(
      `nmcli device wifi connect "${network.name}" password "${password}" ifname ${device}`,
    );
  else await netExecAsync(`nmcli connection up "${network.name}"`);
}

async function nmcliDisconnect(device: string) {
  await netExecAsync(`nmcli device disconnect ${device}`);
}

function iwctlGetDevice(): string {
  for (const line of netExecSync("iwctl device list").split("\n")) {
    if (!line.includes("station")) continue;
    for (const part of line.trim().split(/\s+/))
      if (/^(wlan|wlp|wlo)\w*/.test(part)) return part;
  }
  return "wlan0";
}

async function iwctlScanAndList(device: string): Promise<WifiNetwork[]> {
  await netExecAsync(`iwctl station ${device} scan`);
  await new Promise((r) =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
      r(null);
      return GLib.SOURCE_REMOVE;
    }),
  );
  const out = await netExecAsync(`iwctl station ${device} get-networks`);
  const networks: WifiNetwork[] = [];
  for (const line of out.split("\n")) {
    if (line.includes("Network name") || line.includes("----") || !line.trim())
      continue;
    const connected = line.trim().startsWith(">");
    const clean = line.replace(/>/g, "").trim();
    const parts = clean.split(/\s{2,}/);
    if (parts.length >= 2)
      networks.push({
        name: parts[0].trim(),
        connected,
        security: parts[1]?.trim() || "unknown",
        signal: parts[2]?.trim() || "****",
      });
  }
  return networks.sort((a, b) => Number(b.connected) - Number(a.connected));
}

async function iwctlConnect(
  device: string,
  network: WifiNetwork,
  password?: string,
) {
  const cmd = password
    ? `iwctl station ${device} connect "${network.name}" --passphrase "${password}"`
    : `iwctl station ${device} connect "${network.name}"`;
  await netExecAsync(cmd);
}

async function iwctlDisconnect(device: string) {
  await netExecAsync(`iwctl station ${device} disconnect`);
}

/** Compact Wi-Fi panel for the sidebar revealer — no page title or card wrappers. */
function buildWifiPanel(): Gtk.Widget {
  const backend = wifiDetectBackend();
  const device = backend === "nmcli" ? nmcliGetDevice() : iwctlGetDevice();

  const networks = new Variable<WifiNetwork[]>([]);
  const isScanning = new Variable(false);
  const expandedNetwork = new Variable<string>("");

  const refresh = async () => {
    if (isScanning.get()) return;
    isScanning.set(true);
    try {
      networks.set(
        backend === "nmcli"
          ? await nmcliScanAndList(device)
          : await iwctlScanAndList(device),
      );
    } catch (_) {}
    isScanning.set(false);
  };

  const handleConnect = async (network: WifiNetwork, password?: string) => {
    expandedNetwork.set("");
    try {
      backend === "nmcli"
        ? await nmcliConnect(device, network, password)
        : await iwctlConnect(device, network, password);
    } catch (_) {}
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
      refresh();
      return GLib.SOURCE_REMOVE;
    });
  };

  const handleDisconnect = async () => {
    try {
      backend === "nmcli"
        ? await nmcliDisconnect(device)
        : await iwctlDisconnect(device);
    } catch (_) {}
    refresh();
  };

  const handleClick = (network: WifiNetwork) => {
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

  // Header row: label + scan spinner + refresh button
  const header = new Gtk.Box({ spacing: 8, marginBottom: 6 });
  const titleLbl = new Gtk.Label({
    label: "Wi-Fi",
    xalign: 0,
    hexpand: true,
    cssClasses: ["qs-panel-title"],
  });
  const spinner = new Gtk.Spinner();
  spinner.set_visible(false);
  const scanUnsub = isScanning.subscribe((s) => {
    spinner.set_visible(s);
    s ? spinner.start() : spinner.stop();
  });
  const refreshBtn = new Gtk.Button({
    iconName: "view-refresh-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  const refreshSensUnsub = isScanning.subscribe((s) =>
    refreshBtn.set_sensitive(!s),
  );
  refreshBtn.connect("clicked", () => refresh());
  header.append(titleLbl);
  header.append(spinner);
  header.append(refreshBtn);

  // Network list box
  const listBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
  });

  const makeNetworkItem = (network: WifiNetwork): Gtk.Widget => {
    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });

    const row = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 10,
    });
    row.append(
      new Gtk.Image({
        iconName: network.connected
          ? "network-wireless-connected-symbolic"
          : "network-wireless-symbolic",
      }),
    );

    const nameLbl = new Gtk.Label({
      label: network.name,
      hexpand: true,
      xalign: 0,
    });
    if (network.connected) nameLbl.add_css_class("connected-label");
    row.append(nameLbl);

    if (network.connected)
      row.append(
        new Gtk.Label({
          label: "CONNECTED",
          cssClasses: ["connected-status-pill"],
        }),
      );

    row.append(
      new Gtk.Label({
        label: network.signal,
        cssClasses: ["dim-label"],
        tooltipText: network.security,
      }),
    );

    const btn = new Gtk.Button({
      child: row,
      cssClasses: network.connected
        ? ["network-item", "connected"]
        : ["network-item"],
    });
    const clickId = btn.connect("clicked", () => handleClick(network));
    container.append(btn);

    let subUnsub: (() => void) | null = null;
    if (!["open", "--", ""].includes(network.security) && !network.connected) {
      const pwBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        marginTop: 6,
      });
      const pwEntry = new Gtk.Entry({
        placeholderText: "Password",
        visibility: false,
        hexpand: true,
      });
      const connBtn = new Gtk.Button({
        label: "Connect",
        cssClasses: ["cal-dlg-save"],
      });
      const cancelBtn = new Gtk.Button({ label: "Cancel" });
      const doConnect = () => {
        if (pwEntry.text) handleConnect(network, pwEntry.text);
      };
      pwEntry.connect("activate", doConnect);
      connBtn.connect("clicked", doConnect);
      cancelBtn.connect("clicked", () => expandedNetwork.set(""));
      pwBox.append(pwEntry);
      pwBox.append(connBtn);
      pwBox.append(cancelBtn);

      const revealer = new Gtk.Revealer({
        child: pwBox,
        transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
      });
      subUnsub = expandedNetwork.subscribe((e) => {
        revealer.reveal_child = e === network.name;
      });
      container.append(revealer);
    }

    container.connect("destroy", () => {
      if (subUnsub) subUnsub();
      btn.disconnect(clickId);
    });
    return container;
  };

  const netUnsub = networks.subscribe((list) => {
    let ch: Gtk.Widget | null = listBox.get_first_child();
    while (ch) {
      const n = ch.get_next_sibling();
      listBox.remove(ch);
      ch = n;
    }
    list.forEach((n) => listBox.append(makeNetworkItem(n)));
  });

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
  });
  root.append(header);
  root.append(listBox);
  root.connect("destroy", () => {
    scanUnsub();
    refreshSensUnsub();
    netUnsub();
  });

  refresh();
  return root;
}

// ── Bluetooth helpers (inlined from Bluetooth.tsx) ────────────────────────────

/** Compact Bluetooth panel for the sidebar revealer — no page title or card wrappers. */
function buildBluetoothPanel(): Gtk.Widget {
  const bt = AstalBluetooth.get_default();

  const devices = new Variable<AstalBluetooth.Device[]>([]);
  const isScanning = new Variable(bt.adapter?.discovering ?? false);
  const isPowered = new Variable(bt.adapter?.powered ?? false);

  const btSigs: number[] = [];
  const adSigs: number[] = [];
  let scanTimeout: number | null = null;

  const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

  const sync = () => {
    const all = bt.get_devices() ?? [];
    const filtered = all.filter((d) => {
      if (d.paired) return true;
      const name = d.alias || d.name;
      if (!name || !name.trim() || MAC_RE.test(name)) return false;
      if (name.includes("LE-") && !d.paired) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      if (a.paired !== b.paired) return a.paired ? -1 : 1;
      return (a.alias || "").localeCompare(b.alias || "");
    });
    devices.set(filtered);
  };

  btSigs.push(bt.connect("device-added", sync));
  btSigs.push(bt.connect("device-removed", sync));

  const setupAdapter = () => {
    if (!bt.adapter) return;
    isPowered.set(bt.adapter.powered);
    isScanning.set(bt.adapter.discovering);
    adSigs.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (_) {}
    });
    adSigs.length = 0;
    adSigs.push(
      bt.adapter.connect("notify::powered", () =>
        isPowered.set(bt.adapter.powered),
      ),
    );
    adSigs.push(
      bt.adapter.connect("notify::discovering", () =>
        isScanning.set(bt.adapter.discovering),
      ),
    );
  };
  setupAdapter();
  sync();
  btSigs.push(bt.connect("notify::adapter", setupAdapter));

  const createDeviceRow = (dev: AstalBluetooth.Device): Gtk.Box => {
    const row = new Gtk.Box({ spacing: 10, cssClasses: ["bt-row"] });
    const devSigs: number[] = [];

    const updateConnected = () => {
      if (dev.connected) row.add_css_class("bt-connected");
      else row.remove_css_class("bt-connected");
    };
    devSigs.push(dev.connect("notify::connected", updateConnected));
    updateConnected();

    row.append(
      new Gtk.Image({ iconName: (dev.icon_name || "bluetooth") + "-symbolic" }),
    );

    const nameLbl = new Gtk.Label({
      label: dev.alias || dev.name || "Unknown",
      xalign: 0,
      cssClasses: ["bt-device-name"],
    });
    const pill = new Gtk.Label({
      label: "CONNECTED",
      cssClasses: ["bt-status-pill"],
    });
    const nameRow = new Gtk.Box({ spacing: 6 });
    nameRow.append(nameLbl);
    nameRow.append(pill);

    const updatePill = () => {
      pill.set_visible(dev.connected);
      if (dev.connected) nameLbl.add_css_class("bt-label-active");
      else nameLbl.remove_css_class("bt-label-active");
    };
    devSigs.push(dev.connect("notify::connected", updatePill));
    updatePill();

    const info = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      hexpand: true,
      valign: Gtk.Align.CENTER,
    });
    info.append(nameRow);
    row.append(info);

    if (dev.paired) {
      const forgetBtn = new Gtk.Button({
        iconName: "edit-delete-symbolic",
        cssClasses: ["bt-icon-btn", "bt-danger"],
        valign: Gtk.Align.CENTER,
      });
      devSigs.push(
        forgetBtn.connect("clicked", () => bt.adapter?.remove_device(dev)),
      );
      row.append(forgetBtn);
    }

    const connBtn = new Gtk.Button({
      label: dev.connected ? "Disconnect" : "Connect",
      cssClasses: ["bt-connect-btn"],
      valign: Gtk.Align.CENTER,
    });
    devSigs.push(
      dev.connect("notify::connected", () => {
        connBtn.label = dev.connected ? "Disconnect" : "Connect";
      }),
    );
    devSigs.push(
      connBtn.connect("clicked", () => {
        if (dev.connected) {
          dev.disconnect_device(() => sync());
        } else {
          if (!dev.paired) dev.pair();
          dev.set_trusted(true);
          dev.connect_device(() => sync());
        }
      }),
    );
    row.append(connBtn);

    row.connect("destroy", () => {
      devSigs.forEach((id) => {
        try {
          dev.disconnect(id);
        } catch (_) {}
      });
    });
    return row;
  };

  // Header row: power switch + label + scan spinner + scan button
  const header = new Gtk.Box({ spacing: 8, marginBottom: 6 });
  const titleLbl = new Gtk.Label({
    label: "Bluetooth",
    xalign: 0,
    cssClasses: ["qs-panel-title"],
  });

  const powerSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
  const pwrUnsub = isPowered.subscribe((p) => powerSwitch.set_active(p));
  const pwrId = powerSwitch.connect(
    "state-set",
    (_: Gtk.Switch, state: boolean) => {
      bt.adapter?.set_powered(state);
      return true;
    },
  );

  const spinner = new Gtk.Spinner();
  spinner.set_visible(false);
  const scanUnsub = isScanning.subscribe((s) => {
    spinner.set_visible(s);
    s ? spinner.start() : spinner.stop();
  });

  const scanBtn = new Gtk.Button({
    iconName: "view-refresh-symbolic",
    cssClasses: ["cal-nav-btn"],
  });
  const scanSensUnsub = isScanning.subscribe((s) => scanBtn.set_sensitive(!s));
  scanBtn.connect("clicked", () => {
    if (!bt.adapter) return;
    if (scanTimeout !== null) GLib.source_remove(scanTimeout);
    bt.adapter.start_discovery();
    scanTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
      bt.adapter?.stop_discovery();
      scanTimeout = null;
      return GLib.SOURCE_REMOVE;
    });
  });

  header.append(titleLbl);
  header.append(new Gtk.Box({ hexpand: true }));
  header.append(powerSwitch);
  header.append(spinner);
  header.append(scanBtn);

  // Device list
  const listBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
  });

  const devUnsub = devices.subscribe((list) => {
    let ch: Gtk.Widget | null = listBox.get_first_child();
    while (ch) {
      const n = ch.get_next_sibling();
      listBox.remove(ch);
      ch = n;
    }

    const paired = list.filter((d) => d.paired);
    const available = list.filter((d) => !d.paired);

    if (paired.length > 0) {
      const lbl = new Gtk.Label({
        label: "Paired",
        xalign: 0,
        cssClasses: ["qs-panel-section"],
        marginBottom: 4,
      });
      listBox.append(lbl);
      paired.forEach((d) => listBox.append(createDeviceRow(d)));
    }
    if (available.length > 0) {
      const lbl = new Gtk.Label({
        label: "Available",
        xalign: 0,
        cssClasses: ["qs-panel-section"],
        marginTop: 10,
        marginBottom: 4,
      });
      listBox.append(lbl);
      available.forEach((d) => listBox.append(createDeviceRow(d)));
    }
  });

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
  });
  root.append(header);
  root.append(listBox);
  root.connect("destroy", () => {
    if (scanTimeout !== null) GLib.source_remove(scanTimeout);
    btSigs.forEach((id) => {
      try {
        bt.disconnect(id);
      } catch (_) {}
    });
    adSigs.forEach((id) => {
      try {
        bt.adapter?.disconnect(id);
      } catch (_) {}
    });
    pwrUnsub();
    pwrId;
    scanUnsub();
    scanSensUnsub();
    devUnsub();
    powerSwitch.disconnect(pwrId);
  });

  return root;
}

// ── Shell helpers ─────────────────────────────────────────────────────────────

function exec(cmd: string): string {
  try {
    const [ok, out] = GLib.spawn_command_line_sync(cmd);
    if (ok) return new TextDecoder().decode(out).trim();
  } catch (e) {
    console.error(e);
  }
  return "";
}

async function execAsync(cmd: string): Promise<string> {
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  });
  const proc = launcher.spawnv(GLib.shell_parse_argv(cmd)[1]);
  return new Promise((resolve) => {
    proc.communicate_utf8_async(null, null, (_p, res) => {
      const [, stdout] = proc.communicate_utf8_finish(res);
      resolve(stdout ? stdout.trim() : "");
    });
  });
}

// ── Brightness ────────────────────────────────────────────────────────────────

const wp = AstalWp.get_default();
const maxBrightness = Number(exec("brightnessctl max")) || 100;
const brightness = new Variable(0);

execAsync("brightnessctl get").then((v) =>
  brightness.set(Number(v) / maxBrightness),
);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
  execAsync("brightnessctl get").then((v) =>
    brightness.set(Number(v) / maxBrightness),
  );
  return true;
});

// ── Notification image helper ─────────────────────────────────────────────────

function makeNotifImageBox(src: string): Gtk.Box {
  const url = src.startsWith("file://")
    ? src
    : src.startsWith("/")
      ? `file://${src}`
      : src;
  const box = new Gtk.Box();
  box.set_css_classes(["notification-image-wrapper"]);
  box.set_size_request(56, 56);
  box.set_hexpand(false);
  box.set_vexpand(false);
  box.set_halign(Gtk.Align.CENTER);
  box.set_valign(Gtk.Align.CENTER);
  const p = new Gtk.CssProvider();
  p.load_from_data(
    `* { background-image:url('${url}'); background-size:cover;
         background-position:center; border-radius:6px; }`,
    -1,
  );
  box
    .get_style_context()
    .add_provider(p, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  return box;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RightSidebar({
  gdkmonitor,
}: {
  gdkmonitor: Gdk.Monitor;
}) {
  // win and stack are set inside the window's $= callback.
  // They are accessed lazily by CalendarWidget's getWin getter, which is only
  // called when a dialog actually needs to open — always after construction.
  let win: Astal.Window;
  let stack: Gtk.Stack;
  const notifd = Notifd.get_default();

  const getWin = () => win as Gtk.Window | null;

  // ── Audio panel (output + input devices + per-app streams) ─────────────────

  const AudioPanel = () => {
    const root = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 14,
      cssClasses: ["qs-dropdown-panel"],
    });

    // ── helper: build one volume row ────────────────────────────────────────
    const makeVolumeRow = (
      iconName: string,
      getVol: () => number,
      setVol: (v: number) => void,
      onSignal: (cb: () => void) => () => void,
      muted?: () => boolean,
      toggleMute?: () => void,
    ): Gtk.Box => {
      const row = new Gtk.Box({ spacing: 10 });

      if (toggleMute) {
        const muteBtn = new Gtk.Button({ cssClasses: ["cal-nav-btn"] });
        const setMuteIcon = () => {
          muteBtn.set_child(
            new Gtk.Image({
              iconName: muted!() ? "audio-volume-muted-symbolic" : iconName,
            }),
          );
        };
        setMuteIcon();
        muteBtn.connect("clicked", toggleMute);
        const unsub = onSignal(setMuteIcon);
        muteBtn.connect("destroy", unsub);
        row.append(muteBtn);
      } else {
        row.append(new Gtk.Image({ iconName }));
      }

      const slider = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({
          lower: 0,
          upper: 1,
          stepIncrement: 0.02,
          pageIncrement: 0.1,
          value: getVol(),
        }),
        drawValue: false,
        hexpand: true,
      });
      slider.add_css_class("audio-vol-slider");

      let fromSignal = false;
      const unsub = onSignal(() => {
        fromSignal = true;
        slider.get_adjustment().set_value(getVol());
        fromSignal = false;
      });
      slider.connect("value-changed", () => {
        if (!fromSignal) setVol(slider.get_value());
      });
      slider.connect("destroy", unsub);

      const pctLbl = new Gtk.Label({
        label: `${Math.round(getVol() * 100)}%`,
        cssClasses: ["audio-vol-pct"],
        widthRequest: 38,
        xalign: 1,
      });
      const pctUnsub = onSignal(() => {
        pctLbl.label = `${Math.round(getVol() * 100)}%`;
      });
      pctLbl.connect("destroy", pctUnsub);

      row.append(slider);
      row.append(pctLbl);
      return row;
    };

    // ── helper: build a device-picker row ───────────────────────────────────
    const makeDevicePicker = (
      getDevices: () => AstalWp.Endpoint[],
      getDefault: () => AstalWp.Endpoint | null,
      setDefault: (ep: AstalWp.Endpoint) => void,
      onAudioSignal: (cb: () => void) => () => void,
    ): Gtk.Box => {
      const row = new Gtk.Box({ spacing: 8, marginTop: 2 });

      const store = Gtk.StringList.new([]);
      const drop = new Gtk.DropDown({
        model: store,
        hexpand: true,
        cssClasses: ["audio-device-drop"],
      });

      let devices: AstalWp.Endpoint[] = [];
      let suppressSignal = false;

      const refresh = () => {
        devices = getDevices();
        const def = getDefault();

        // Rebuild string list
        while (store.get_n_items() > 0) store.remove(0);
        devices.forEach((d) =>
          store.append(d.description || d.name || "Unknown"),
        );

        const idx = def ? devices.findIndex((d) => d === def) : -1;
        suppressSignal = true;
        drop.set_selected(idx >= 0 ? idx : 0);
        suppressSignal = false;
      };

      const unsub = onAudioSignal(refresh);
      refresh();

      drop.connect("notify::selected", () => {
        if (suppressSignal) return;
        const d = devices[drop.get_selected()];
        if (d) setDefault(d);
      });
      drop.connect("destroy", unsub);

      row.append(
        new Gtk.Image({
          iconName: "audio-card-symbolic",
          cssClasses: ["audio-device-icon"],
        }),
      );
      row.append(drop);
      return row;
    };

    // ── helper: subscribe wrapper for wp.audio signals ──────────────────────
    const onAudio = (cb: () => void): (() => void) => {
      const ids: number[] = [];
      if (wp?.audio) {
        ids.push(wp.audio.connect("notify::default-speaker", cb));
        ids.push(wp.audio.connect("notify::default-microphone", cb));
        ids.push(wp.audio.connect("speaker-added", cb));
        ids.push(wp.audio.connect("speaker-removed", cb));
        ids.push(wp.audio.connect("microphone-added", cb));
        ids.push(wp.audio.connect("microphone-removed", cb));
        ids.push(wp.audio.connect("stream-added", cb));
        ids.push(wp.audio.connect("stream-removed", cb));
      }
      return () =>
        ids.forEach((id) => {
          try {
            wp?.audio?.disconnect(id);
          } catch (_) {}
        });
    };

    const onSpeaker = (cb: () => void): (() => void) => {
      let id: number | null = null;
      const attach = () => {
        if (wp?.audio?.defaultSpeaker)
          id = wp.audio.defaultSpeaker.connect("notify::volume", cb);
      };
      attach();
      const sigId = wp?.audio?.connect("notify::default-speaker", () => {
        if (id !== null) {
          try {
            wp.audio?.defaultSpeaker?.disconnect(id);
          } catch (_) {}
        }
        attach();
        cb();
      });
      return () => {
        if (id !== null) {
          try {
            wp?.audio?.defaultSpeaker?.disconnect(id);
          } catch (_) {}
        }
        if (sigId != null) {
          try {
            wp?.audio?.disconnect(sigId);
          } catch (_) {}
        }
      };
    };

    const onMic = (cb: () => void): (() => void) => {
      let id: number | null = null;
      const attach = () => {
        if (wp?.audio?.defaultMicrophone)
          id = wp.audio.defaultMicrophone.connect("notify::volume", cb);
      };
      attach();
      const sigId = wp?.audio?.connect("notify::default-microphone", () => {
        if (id !== null) {
          try {
            wp.audio?.defaultMicrophone?.disconnect(id);
          } catch (_) {}
        }
        attach();
        cb();
      });
      return () => {
        if (id !== null) {
          try {
            wp?.audio?.defaultMicrophone?.disconnect(id);
          } catch (_) {}
        }
        if (sigId != null) {
          try {
            wp?.audio?.disconnect(sigId);
          } catch (_) {}
        }
      };
    };

    // ── Section: Output ─────────────────────────────────────────────────────
    const outSectionLbl = new Gtk.Label({
      label: "Output",
      xalign: 0,
      cssClasses: ["qs-panel-section"],
      marginBottom: 4,
    });
    root.append(outSectionLbl);

    root.append(
      makeVolumeRow(
        "audio-speakers-symbolic",
        () => wp?.audio?.defaultSpeaker?.volume ?? 0,
        (v) => {
          if (wp?.audio?.defaultSpeaker) wp.audio.defaultSpeaker.volume = v;
        },
        onSpeaker,
        () => wp?.audio?.defaultSpeaker?.mute ?? false,
        () => {
          if (wp?.audio?.defaultSpeaker)
            wp.audio.defaultSpeaker.mute = !wp.audio.defaultSpeaker.mute;
        },
      ),
    );

    root.append(
      makeDevicePicker(
        () => (wp?.audio?.get_speakers() ?? []) as AstalWp.Endpoint[],
        () => wp?.audio?.defaultSpeaker ?? null,
        (ep) => {
          (ep as any).set_is_default(true);
        },
        onAudio,
      ),
    );

    // ── Section: Input ──────────────────────────────────────────────────────
    const inSep = new Gtk.Separator({
      orientation: Gtk.Orientation.HORIZONTAL,
      marginTop: 4,
      marginBottom: 4,
    });
    root.append(inSep);

    const inSectionLbl = new Gtk.Label({
      label: "Input",
      xalign: 0,
      cssClasses: ["qs-panel-section"],
      marginBottom: 4,
    });
    root.append(inSectionLbl);

    root.append(
      makeVolumeRow(
        "audio-input-microphone-symbolic",
        () => wp?.audio?.defaultMicrophone?.volume ?? 0,
        (v) => {
          if (wp?.audio?.defaultMicrophone)
            wp.audio.defaultMicrophone.volume = v;
        },
        onMic,
        () => wp?.audio?.defaultMicrophone?.mute ?? false,
        () => {
          if (wp?.audio?.defaultMicrophone)
            wp.audio.defaultMicrophone.mute = !wp.audio.defaultMicrophone.mute;
        },
      ),
    );

    root.append(
      makeDevicePicker(
        () => (wp?.audio?.get_microphones() ?? []) as AstalWp.Endpoint[],
        () => wp?.audio?.defaultMicrophone ?? null,
        (ep) => {
          (ep as any).set_is_default(true);
        },
        onAudio,
      ),
    );

    // ── Section: Apps ───────────────────────────────────────────────────────
    const appSep = new Gtk.Separator({
      orientation: Gtk.Orientation.HORIZONTAL,
      marginTop: 4,
      marginBottom: 4,
    });
    root.append(appSep);

    const appSectionLbl = new Gtk.Label({
      label: "Apps",
      xalign: 0,
      cssClasses: ["qs-panel-section"],
      marginBottom: 4,
    });
    root.append(appSectionLbl);

    const appsBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 10,
    });
    root.append(appsBox);

    const renderApps = () => {
      // Clear
      let ch: Gtk.Widget | null = appsBox.get_first_child();
      while (ch) {
        const n = ch.get_next_sibling();
        appsBox.remove(ch);
        ch = n;
      }

      const streams: AstalWp.Stream[] = (wp?.audio?.get_streams() ??
        []) as AstalWp.Stream[];
      if (!streams.length) {
        appsBox.append(
          new Gtk.Label({
            label: "No active streams",
            xalign: 0,
            cssClasses: ["cal-empty"],
          }),
        );
        return;
      }

      streams.forEach((stream) => {
        const name =
          (stream as any).name || (stream as any).app_name || "Unknown";
        const icon =
          (stream as any).icon ||
          (stream as any).app_icon ||
          "application-x-executable-symbolic";

        const appRow = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 6,
        });

        const labelRow = new Gtk.Box({ spacing: 8 });
        const appIcon = new Gtk.Image({
          iconName: icon,
          cssClasses: ["audio-app-icon"],
        });
        const appName = new Gtk.Label({
          label: name,
          xalign: 0,
          hexpand: true,
          cssClasses: ["audio-app-name"],
        });
        appName.set_ellipsize(3);
        const appPct = new Gtk.Label({
          label: `${Math.round(((stream as any).volume ?? 0) * 100)}%`,
          cssClasses: ["audio-vol-pct"],
          widthRequest: 38,
          xalign: 1,
        });

        const mutBtn = new Gtk.Button({ cssClasses: ["cal-nav-btn"] });
        const setMutIcon = () => {
          mutBtn.set_child(
            new Gtk.Image({
              iconName: (stream as any).mute
                ? "audio-volume-muted-symbolic"
                : "audio-volume-medium-symbolic",
            }),
          );
        };
        setMutIcon();
        mutBtn.connect("clicked", () => {
          (stream as any).mute = !(stream as any).mute;
        });

        const volIds: number[] = [];
        volIds.push(
          stream.connect("notify::volume", () => {
            appPct.label = `${Math.round(((stream as any).volume ?? 0) * 100)}%`;
            appSlider.get_adjustment().set_value((stream as any).volume ?? 0);
          }),
        );
        volIds.push(stream.connect("notify::mute", setMutIcon));

        labelRow.append(appIcon);
        labelRow.append(appName);
        labelRow.append(appPct);
        labelRow.append(mutBtn);

        const appSlider = new Gtk.Scale({
          orientation: Gtk.Orientation.HORIZONTAL,
          adjustment: new Gtk.Adjustment({
            lower: 0,
            upper: 1.5,
            stepIncrement: 0.02,
            pageIncrement: 0.1,
            value: (stream as any).volume ?? 0,
          }),
          drawValue: false,
          hexpand: true,
        });
        appSlider.add_css_class("audio-vol-slider");
        let fromStreamSignal = false;
        volIds.push(
          stream.connect("notify::volume", () => {
            fromStreamSignal = true;
            appSlider.get_adjustment().set_value((stream as any).volume ?? 0);
            fromStreamSignal = false;
          }),
        );
        appSlider.connect("value-changed", () => {
          if (!fromStreamSignal) (stream as any).volume = appSlider.get_value();
        });

        appSlider.connect("destroy", () => {
          volIds.forEach((id) => {
            try {
              stream.disconnect(id);
            } catch (_) {}
          });
        });

        appRow.append(labelRow);
        appRow.append(appSlider);
        appsBox.append(appRow);
      });
    };

    const appUnsub = onAudio(renderApps);
    renderApps();
    appsBox.connect("destroy", appUnsub);

    return root;
  };

  const BrightnessSliderPanel = () => (
    <box cssClasses={["qs-dropdown-panel"]} spacing={12}>
      <image iconName="display-brightness-symbolic" />
      <slider
        hexpand
        onValueChanged={(self) => {
          execAsync(`brightnessctl set ${Math.floor(self.value * 100)}%`);
          brightness.set(self.value);
        }}
        $={(self) => {
          const unsub = brightness.subscribe((v) => {
            if (Math.abs(self.value - v) > 0.01) self.value = v;
          });
          self.connect("destroy", unsub);
        }}
      />
    </box>
  );

  const NotificationCenter = () => (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["notification-section"]}
      spacing={10}
    >
      <box cssClasses={["notification-header"]} spacing={12}>
        <label
          label="Notifications"
          halign={Gtk.Align.START}
          cssClasses={["notification-title"]}
        />
        <box hexpand />
        <button
          cssClasses={["clear-all"]}
          onClicked={() =>
            notifd.get_notifications()?.forEach((n) => n.dismiss())
          }
        >
          <label label="Clear All" />
        </button>
      </box>

      <Gtk.ScrolledWindow
        maxContentHeight={220}
        cssClasses={["notification-list"]}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={6}
          $={(self) => {
            const render = () => {
              let ch = self.get_first_child();
              while (ch) {
                const n = ch.get_next_sibling();
                self.remove(ch);
                ch = n;
              }

              const list = notifd.get_notifications();
              if (!list?.length) {
                const empty = new Gtk.Box({
                  css_classes: ["no-notifications"],
                });
                empty.append(new Gtk.Label({ label: "No notifications" }));
                self.append(empty);
                return;
              }

              list.forEach((notif) => {
                // Manual GTK construction to avoid "out of tracking context"
                const item = new Gtk.Box({
                  css_classes: ["notification-item"],
                  orientation: Gtk.Orientation.HORIZONTAL,
                  spacing: 10,
                });

                if (notif.image) {
                  item.append(makeNotifImageBox(notif.image));
                }

                const contentBox = new Gtk.Box({
                  orientation: Gtk.Orientation.VERTICAL,
                  spacing: 3,
                  hexpand: true,
                });

                const titleRow = new Gtk.Box({ spacing: 6 });
                const summary = new Gtk.Label({
                  label: notif.summary,
                  halign: Gtk.Align.START,
                  hexpand: true,
                  css_classes: ["notification-summary"],
                  ellipsize: Pango.EllipsizeMode.END,
                  max_width_chars: 22,
                });

                const closeBtn = new Gtk.Button({
                  css_classes: ["dismiss-button"],
                });
                closeBtn.set_child(new Gtk.Label({ label: "×" }));
                closeBtn.connect("clicked", () => notif.dismiss());

                titleRow.append(summary);
                titleRow.append(closeBtn);
                contentBox.append(titleRow);

                if (notif.body) {
                  const body = new Gtk.Label({
                    label: notif.body,
                    halign: Gtk.Align.START,
                    wrap: true,
                    use_markup: true,
                    css_classes: ["notification-body"],
                    ellipsize: Pango.EllipsizeMode.END,
                    lines: 2,
                  });
                  contentBox.append(body);
                }

                item.append(contentBox);
                self.append(item);
              });
            };

            render();
            const id1 = notifd.connect("notified", render);
            const id2 = notifd.connect("resolved", render);
            self.connect("destroy", () => {
              notifd.disconnect(id1);
              notifd.disconnect(id2);
            });
          }}
        />
      </Gtk.ScrolledWindow>
    </box>
  );
  // ── Main page ─────────────────────────────────────────────────────────────
  // Built as a function so the CalendarWidget receives `getWin` which lazily
  // resolves to `win` after the window has been constructed.

  const buildMainPage = (): Gtk.Widget => {
    // ── Revealer open/close state ───────────────────────────────────────────
    let volumeOpen = false;
    let brightnessOpen = false;
    let wifiOpen = false;
    let btOpen = false;

    let volumeRevealer: Gtk.Revealer;
    let brightnessRevealer: Gtk.Revealer;
    let wifiRevealer: Gtk.Revealer;
    let btRevealer: Gtk.Revealer;

    let volumeBtn: Gtk.Button;
    let brightnessBtn: Gtk.Button;
    let wifiBtn: Gtk.Button;
    let btBtn: Gtk.Button;

    const toggle = (which: "volume" | "brightness" | "wifi" | "bt") => {
      volumeOpen = which === "volume" ? !volumeOpen : false;
      brightnessOpen = which === "brightness" ? !brightnessOpen : false;
      wifiOpen = which === "wifi" ? !wifiOpen : false;
      btOpen = which === "bt" ? !btOpen : false;

      volumeRevealer.reveal_child = volumeOpen;
      brightnessRevealer.reveal_child = brightnessOpen;
      wifiRevealer.reveal_child = wifiOpen;
      btRevealer.reveal_child = btOpen;

      [
        [volumeBtn, volumeOpen],
        [brightnessBtn, brightnessOpen],
        [wifiBtn, wifiOpen],
        [btBtn, btOpen],
      ].forEach(([btn, open]) => {
        const b = btn as Gtk.Button;
        if (open) b.add_css_class("active");
        else b.remove_css_class("active");
      });
    };

    // ── Fixed top section ───────────────────────────────────────────────────
    const top = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 18,
    });

    const header = (
      <box cssClasses={["sidebar-header"]} spacing={10}>
        <label
          label="Quick Settings"
          hexpand
          xalign={0}
          cssClasses={["sidebar-title"]}
        />
        <button
          cssClasses={["settings-toggle"]}
          widthRequest={40}
          heightRequest={40}
          onClicked={() => {
            app.toggle_window(`settings-window-${gdkmonitor.connector}`);
            win.hide();
          }}
        >
          <image iconName="emblem-system-symbolic" />
        </button>
        <button
          cssClasses={["powermenu-toggle"]}
          widthRequest={40}
          heightRequest={40}
          onClicked={() => {
            app.toggle_window(`powermenu-${gdkmonitor.connector}`);
            win.hide();
          }}
        >
          <image iconName="system-shutdown-symbolic" />
        </button>
      </box>
    ) as Gtk.Widget;

    // ── Bar-style button grid ───────────────────────────────────────────────
    // Row 1: Volume | Brightness
    const row1 = new Gtk.Box({ spacing: 8 });

    volumeBtn = new Gtk.Button();
    volumeBtn.set_css_classes(["qs-bar-btn"]);
    volumeBtn.set_hexpand(true);
    const volInner = new Gtk.Box({ spacing: 8 });
    volInner.append(new Gtk.Image({ iconName: "audio-speakers-symbolic" }));
    volInner.append(
      Object.assign(
        new Gtk.Label({ label: "Volume", xalign: 0, hexpand: true }),
        {},
      ),
    );
    volInner.append(new Gtk.Image({ iconName: "go-down-symbolic" }));
    volumeBtn.set_child(volInner);
    volumeBtn.connect("clicked", () => toggle("volume"));

    brightnessBtn = new Gtk.Button();
    brightnessBtn.set_css_classes(["qs-bar-btn"]);
    brightnessBtn.set_hexpand(true);
    const briInner = new Gtk.Box({ spacing: 8 });
    briInner.append(new Gtk.Image({ iconName: "display-brightness-symbolic" }));
    briInner.append(
      Object.assign(
        new Gtk.Label({ label: "Brightness", xalign: 0, hexpand: true }),
        {},
      ),
    );
    briInner.append(new Gtk.Image({ iconName: "go-down-symbolic" }));
    brightnessBtn.set_child(briInner);
    brightnessBtn.connect("clicked", () => toggle("brightness"));

    row1.append(volumeBtn);
    row1.append(brightnessBtn);

    // Row 2: Wi-Fi | Bluetooth
    const row2 = new Gtk.Box({ spacing: 8 });

    wifiBtn = new Gtk.Button();
    wifiBtn.set_css_classes(["qs-bar-btn"]);
    wifiBtn.set_hexpand(true);
    const wifiInner = new Gtk.Box({ spacing: 8 });
    wifiInner.append(new Gtk.Image({ iconName: "network-wireless-symbolic" }));
    wifiInner.append(
      Object.assign(
        new Gtk.Label({ label: "Wi-Fi", xalign: 0, hexpand: true }),
        {},
      ),
    );
    wifiInner.append(new Gtk.Image({ iconName: "go-down-symbolic" }));
    wifiBtn.set_child(wifiInner);
    wifiBtn.connect("clicked", () => toggle("wifi"));

    btBtn = new Gtk.Button();
    btBtn.set_css_classes(["qs-bar-btn"]);
    btBtn.set_hexpand(true);
    const btInner = new Gtk.Box({ spacing: 8 });
    btInner.append(new Gtk.Image({ iconName: "bluetooth-symbolic" }));
    btInner.append(
      Object.assign(
        new Gtk.Label({ label: "Bluetooth", xalign: 0, hexpand: true }),
        {},
      ),
    );
    btInner.append(new Gtk.Image({ iconName: "go-down-symbolic" }));
    btBtn.set_child(btInner);
    btBtn.connect("clicked", () => toggle("bt"));

    row2.append(wifiBtn);
    row2.append(btBtn);

    // Row 3: Edit Layout (full width)
    const editBtn = new Gtk.Button();
    editBtn.set_css_classes(["qs-bar-btn"]);
    const editInner = new Gtk.Box({ spacing: 8 });
    const editIcon = new Gtk.Image({ iconName: "view-grid-symbolic" });
    const editLbl = new Gtk.Label({
      label: "Edit Layout",
      xalign: 0,
      hexpand: true,
    });
    const editCheck = new Gtk.Image({
      iconName: "object-select-symbolic",
      visible: false,
    });
    editInner.append(editIcon);
    editInner.append(editLbl);
    editInner.append(editCheck);
    editBtn.set_child(editInner);
    const editUnsub = editMode.subscribe((v) => {
      editLbl.label = v ? "Exit Edit Mode" : "Edit Layout";
      editCheck.visible = v;
      if (v) editBtn.add_css_class("active");
      else editBtn.remove_css_class("active");
    });
    editBtn.connect("clicked", () => toggleEditMode());
    editBtn.connect("destroy", editUnsub);

    const btnBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 8,
    });
    btnBox.append(row1);
    btnBox.append(row2);
    btnBox.append(editBtn);

    top.append(header);
    top.append(btnBox);

    // ── Scrollable section ──────────────────────────────────────────────────
    const scroll = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });

    const scrollInner = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
    });
    scrollInner.set_margin_top(8);

    // Dropdown revealers (stacked at top of scroll, above notifications)
    const makeDropdownRevealer = (child: Gtk.Widget) => {
      const revealer = new Gtk.Revealer({
        transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN,
        transitionDuration: 200,
        revealChild: false,
        child,
      });
      scrollInner.append(revealer);
      return revealer;
    };

    volumeRevealer = makeDropdownRevealer(AudioPanel());
    brightnessRevealer = makeDropdownRevealer(
      (<BrightnessSliderPanel />) as Gtk.Widget,
    );

    // WiFi panel — content flows directly into outer sidebar scroll
    const wifiPanel = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      cssClasses: ["qs-dropdown-panel"],
    });
    wifiPanel.append(buildWifiPanel());
    wifiRevealer = makeDropdownRevealer(wifiPanel);

    // BT panel — same pattern
    const btPanel = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      cssClasses: ["qs-dropdown-panel"],
    });
    btPanel.append(buildBluetoothPanel());
    btRevealer = makeDropdownRevealer(btPanel);

    // Separator between dropdowns and notifications
    scrollInner.append(
      new Gtk.Separator({
        orientation: Gtk.Orientation.HORIZONTAL,
        marginTop: 8,
        marginBottom: 4,
      }),
    );

    // Notifications
    scrollInner.append((<NotificationCenter />) as Gtk.Widget);
    scrollInner.append(
      new Gtk.Separator({
        orientation: Gtk.Orientation.HORIZONTAL,
        marginTop: 4,
        marginBottom: 4,
      }),
    );

    // Calendar section header
    const calHeader = new Gtk.Box({ spacing: 8, marginBottom: 4 });
    calHeader.append(
      new Gtk.Label({
        label: "Calendar",
        xalign: 0,
        hexpand: true,
        cssClasses: ["cal-section-title"],
      }),
    );
    scrollInner.append(calHeader);

    scrollInner.append(
      CalendarWidget(getWin, (date) => {
        const existing = stack.get_child_by_name("dayview");
        if (existing) stack.remove(existing);
        stack.add_named(
          buildDayView(getWin, date, () =>
            stack.set_visible_child_name("main"),
          ),
          "dayview",
        );
        stack.set_visible_child_name("dayview");
      }),
    );

    scroll.set_child(scrollInner);

    const page = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 0,
      vexpand: true,
    });
    page.add_css_class("main-sidebar-page");
    page.append(top);
    page.append(scroll);
    return page;
  };

  // ── Window ────────────────────────────────────────────────────────────────

  return (
    <window
      $={(self) => {
        win = self as Astal.Window;
        const keys = new Gtk.EventControllerKey();
        keys.connect("key-pressed", (_, kv) => {
          if (kv === Gdk.KEY_Escape) {
            if (stack.visible_child_name !== "main")
              stack.set_visible_child_name("main");
            else self.hide();
            return Gdk.EVENT_STOP;
          }
          return Gdk.EVENT_PROPAGATE;
        });
        self.add_controller(keys);
      }}
      visible={false}
      namespace="sidebar"
      name={`RightSidebar-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.RIGHT |
        Astal.WindowAnchor.BOTTOM
      }
      exclusivity={Astal.Exclusivity.NORMAL}
      application={app}
      layer={Astal.Layer.OVERLAY}
      keymode={Astal.Keymode.ON_DEMAND}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["sidebar-container"]}
        widthRequest={380}
      >
        <stack
          $={(self) => {
            stack = self;
            self.add_named(buildMainPage(), "main");
            self.set_visible_child_name("main");
          }}
          vexpand
          transitionType={Gtk.StackTransitionType.SLIDE_LEFT_RIGHT}
          transitionDuration={250}
        />
      </box>
    </window>
  );
}
