import Gtk from "gi://Gtk?version=4.0"
import GLib from "gi://GLib"

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
        console.log(`Variable.set() called with:`, newValue);
        this.value = newValue;
        this.subscribers.forEach(callback => callback(this.value));
    }

    subscribe(callback: (value: T) => void) {
        this.subscribers.push(callback);
        callback(this.value);
    }
}

// Strip ANSI escape codes
function stripAnsi(str: string): string {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
}

function execSync(cmd: string): string {
    console.log(`[execSync] Running command: ${cmd}`);
    try {
        const [success, stdout, stderr] = GLib.spawn_command_line_sync(cmd);
        console.log(`[execSync] Success: ${success}`);
        if (success && stdout) {
            const output = new TextDecoder().decode(stdout).trim();
            const cleaned = stripAnsi(output);
            console.log(`[execSync] Output length: ${output.length}`);
            console.log(`[execSync] Cleaned output: ${cleaned}`);
            return cleaned;
        }
        if (stderr) {
            const error = new TextDecoder().decode(stderr).trim();
            console.log(`[execSync] Stderr: ${error}`);
        }
    } catch (err) {
        console.error(`[execSync] Failed to execute: ${cmd}`, err);
    }
    return "";
}

function execAsyncNoWait(cmd: string): void {
    console.log(`[execAsyncNoWait] Running command: ${cmd}`);
    try {
        GLib.spawn_command_line_async(cmd);
        console.log(`[execAsyncNoWait] Command launched`);
    } catch (err) {
        console.error(`[execAsyncNoWait] Failed to execute: ${cmd}`, err);
    }
}

interface WifiNetwork {
    name: string;
    connected: boolean;
    security: string;
    signal: string;
}

function getWifiDevice(): string {
    console.log("[getWifiDevice] Getting WiFi device...");
    const output = execSync("iwctl device list");
    const lines = output.split('\n');
    
    console.log(`[getWifiDevice] Total lines: ${lines.length}`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`[getWifiDevice] Line ${i}: "${line}"`);
        
        if (line.includes('station')) {
            const trimmed = line.trim();
            const parts = trimmed.split(/\s+/);
            console.log(`[getWifiDevice] Parts:`, parts);
            
            for (const part of parts) {
                if (part.match(/^(wlan|wlp|wlo)\w*/)) {
                    console.log(`[getWifiDevice] Found device: ${part}`);
                    return part;
                }
            }
        }
    }
    
    console.log("[getWifiDevice] No device found, using fallback: wlan0");
    return "wlan0";
}

function scanNetworks(device: string): WifiNetwork[] {
    console.log(`[scanNetworks] Scanning networks on device: ${device}`);
    
    execSync(`iwctl station ${device} scan`);
    
    console.log("[scanNetworks] Waiting 1000ms for scan to complete...");
    GLib.usleep(1000000);
    
    const output = execSync(`iwctl station ${device} get-networks`);
    const lines = output.split('\n');
    const networks: WifiNetwork[] = [];
    
    console.log(`[scanNetworks] Parsing ${lines.length} lines`);
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`[scanNetworks] Line ${i}: "${line}"`);
        
        if (line.includes('Network name') || 
            line.includes('Available networks') ||
            line.trim() === '' || 
            line.includes('----') ||
            line.includes('No networks')) {
            console.log(`[scanNetworks] Skipping header/empty line`);
            continue;
        }
        
        const connected = line.trim().startsWith('>');
        const cleanLine = line.replace('>', '').trim();
        const parts = cleanLine.split(/\s{2,}/);
        
        console.log(`[scanNetworks] Connected: ${connected}, Parts:`, parts);
        
        if (parts.length >= 2) {
            const network = {
                name: parts[0].trim(),
                connected: connected,
                security: parts[1]?.trim() || "unknown",
                signal: parts[2]?.trim() || "****"
            };
            console.log(`[scanNetworks] Added network:`, network);
            networks.push(network);
        } else {
            console.log(`[scanNetworks] Not enough parts, skipping`);
        }
    }
    
    console.log(`[scanNetworks] Found ${networks.length} networks`);
    return networks;
}

function connectToNetwork(device: string, ssid: string, password?: string) {
    console.log(`[connectToNetwork] Device: ${device}, SSID: ${ssid}, Has password: ${!!password}`);
    if (password) {
        execAsyncNoWait(`iwctl station ${device} connect "${ssid}" --passphrase "${password}"`);
    } else {
        execAsyncNoWait(`iwctl station ${device} connect "${ssid}"`);
    }
}

function disconnectNetwork(device: string) {
    console.log(`[disconnectNetwork] Device: ${device}`);
    execAsyncNoWait(`iwctl station ${device} disconnect`);
}

export default function NetworkPage() {
    console.log("[NetworkPage] Initializing...");
    
    const device = getWifiDevice();
    console.log(`[NetworkPage] Using device: ${device}`);
    
    const networks = new Variable<WifiNetwork[]>([]);
    const selectedNetwork = new Variable<string>("");
    const isScanning = new Variable(false);
    const expandedNetwork = new Variable<string>("");

    const refreshNetworks = () => {
        console.log("[refreshNetworks] Starting refresh...");
        isScanning.set(true);
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            console.log("[refreshNetworks] Timeout callback executing...");
            const foundNetworks = scanNetworks(device);
            console.log(`[refreshNetworks] Found ${foundNetworks.length} networks`);
            networks.set(foundNetworks);
            isScanning.set(false);
            console.log("[refreshNetworks] Refresh complete");
            return GLib.SOURCE_REMOVE;
        });
    };

    const handleNetworkClick = (network: WifiNetwork) => {
        console.log(`[handleNetworkClick] Network clicked:`, network);
        
        if (network.connected) {
            console.log("[handleNetworkClick] Already connected, disconnecting...");
            disconnectNetwork(device);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                refreshNetworks();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        
        selectedNetwork.set(network.name);
        
        // If open network, connect immediately
        if (network.security === "open") {
            console.log("[handleNetworkClick] Open network, connecting...");
            connectToNetwork(device, network.name);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                refreshNetworks();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            // Expand password input
            console.log("[handleNetworkClick] Secured network, expanding password input...");
            expandedNetwork.set(network.name);
        }
    };

    const handleConnect = (network: WifiNetwork, password: string) => {
        console.log(`[handleConnect] Connecting to ${network.name} with password`);
        connectToNetwork(device, network.name, password);
        expandedNetwork.set(""); // Collapse password input
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            refreshNetworks();
            return GLib.SOURCE_REMOVE;
        });
    };

    // Initial scan
    console.log("[NetworkPage] Starting initial scan...");
    refreshNetworks();

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={24} cssClasses={["page-container"]}>
            <Gtk.Label label="Network" xalign={0} cssClasses={["page-title"]} />
            
            {/* WiFi Status */}
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={["settings-card"]} spacing={16}>
                <Gtk.Box orientation={Gtk.Orientation.HORIZONTAL} spacing={12}>
                    <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
                        <Gtk.Label 
                            label="WiFi Device" 
                            xalign={0} 
                            cssClasses={["section-title"]} 
                        />
                        <Gtk.Label 
                            label={device}
                            xalign={0}
                            cssClasses={["dim-label"]}
                        />
                    </Gtk.Box>
                    <Gtk.Button
                        iconName="view-refresh-symbolic"
                        cssClasses={["icon-button"]}
                        onClicked={() => {
                            console.log("[RefreshButton] Clicked");
                            refreshNetworks();
                        }}
                        $={(self: any) => {
                            isScanning.subscribe(scanning => {
                                console.log(`[RefreshButton] Scanning state: ${scanning}`);
                                self.set_sensitive(!scanning);
                            });
                        }}
                    />
                </Gtk.Box>
            </Gtk.Box>

            {/* Network List */}
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={["settings-card"]} spacing={16}>
                <Gtk.Label 
                    label="Available Networks" 
                    xalign={0} 
                    cssClasses={["section-title"]} 
                />
                
                <Gtk.ScrolledWindow heightRequest={400} vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}>
                    <Gtk.Box 
                        orientation={Gtk.Orientation.VERTICAL} 
                        spacing={4}
                        $={(self: any) => {
                            console.log("[NetworkList] Initializing...");
                            
                            const createNetworkItem = (network: WifiNetwork) => {
                                let passwordEntry: Gtk.Entry | null = null;
                                
                                // Network item container
                                const container = new Gtk.Box({
                                    orientation: Gtk.Orientation.VERTICAL,
                                    spacing: 0
                                });
                                
                                // Button content box
                                const buttonBox = new Gtk.Box({
                                    orientation: Gtk.Orientation.HORIZONTAL,
                                    spacing: 12
                                });
                                
                                const icon = new Gtk.Image({
                                    iconName: network.connected ? "network-wireless-signal-excellent-symbolic" : "network-wireless-symbolic"
                                });
                                
                                const nameLabel = new Gtk.Label({
                                    label: network.name,
                                    hexpand: true,
                                    xalign: 0
                                });
                                
                                const signalLabel = new Gtk.Label({
                                    label: network.signal,
                                    cssClasses: ["dim-label"]
                                });
                                
                                const securityLabel = new Gtk.Label({
                                    label: network.security,
                                    cssClasses: ["dim-label"]
                                });
                                
                                buttonBox.append(icon);
                                buttonBox.append(nameLabel);
                                buttonBox.append(signalLabel);
                                buttonBox.append(securityLabel);
                                
                                // Main network button
                                const button = new Gtk.Button({
                                    child: buttonBox,
                                    cssClasses: network.connected ? ["network-item", "connected"] : ["network-item"]
                                });
                                
                                button.connect("clicked", () => handleNetworkClick(network));
                                container.append(button);
                                
                                // Password input revealer (for secured networks)
                                if (network.security !== "open" && !network.connected) {
                                    const passwordBox = new Gtk.Box({
                                        orientation: Gtk.Orientation.HORIZONTAL,
                                        spacing: 8,
                                        cssClasses: ["network-password-box"]
                                    });
                                    
                                    passwordEntry = new Gtk.Entry({
                                        placeholderText: "Enter password",
                                        visibility: false,
                                        hexpand: true
                                    });
                                    
                                    const connectBtn = new Gtk.Button({
                                        label: "Connect",
                                        cssClasses: ["primary-button"]
                                    });
                                    
                                    const cancelBtn = new Gtk.Button({
                                        label: "Cancel",
                                        cssClasses: ["secondary-button"]
                                    });
                                    
                                    const doConnect = () => {
                                        if (passwordEntry) {
                                            const password = passwordEntry.get_text();
                                            if (password) {
                                                handleConnect(network, password);
                                                passwordEntry.set_text("");
                                            }
                                        }
                                    };
                                    
                                    passwordEntry.connect("activate", doConnect);
                                    connectBtn.connect("clicked", doConnect);
                                    cancelBtn.connect("clicked", () => {
                                        expandedNetwork.set("");
                                        if (passwordEntry) passwordEntry.set_text("");
                                    });
                                    
                                    passwordBox.append(passwordEntry);
                                    passwordBox.append(connectBtn);
                                    passwordBox.append(cancelBtn);
                                    
                                    const revealer = new Gtk.Revealer({
                                        child: passwordBox,
                                        transitionType: Gtk.RevealerTransitionType.SLIDE_DOWN
                                    });
                                    
                                    expandedNetwork.subscribe(expanded => {
                                        revealer.set_reveal_child(expanded === network.name);
                                    });
                                    
                                    container.append(revealer);
                                }
                                
                                return container;
                            };
                            
                            networks.subscribe(networkList => {
                                console.log(`[NetworkList] Networks updated, count: ${networkList.length}`);
                                
                                // Clear existing children
                                let child = self.get_first_child();
                                while (child) {
                                    const next = child.get_next_sibling();
                                    self.remove(child);
                                    child = next;
                                }
                                
                                // Add new network items
                                networkList.forEach((network, i) => {
                                    console.log(`[NetworkList] Adding network ${i}:`, network);
                                    const item = createNetworkItem(network);
                                    self.append(item);
                                });
                            });
                        }}
                    />
                </Gtk.ScrolledWindow>
            </Gtk.Box>

            {/* IWD Info */}
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} cssClasses={["settings-card"]} spacing={10}>
                <Gtk.Label 
                    label="IWD Status" 
                    xalign={0} 
                    cssClasses={["section-title"]} 
                />
                <Gtk.Label 
                    $={(self: any) => {
                        const status = execSync("systemctl is-active iwd");
                        console.log(`[IWDStatus] Status: ${status}`);
                        self.set_label(`Service Status: ${status}`);
                    }}
                    xalign={0}
                    cssClasses={["dim-label"]}
                />
            </Gtk.Box>
        </Gtk.Box>
    )
}