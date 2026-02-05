import Gtk from "gi://Gtk?version=4.0"
import AstalNetwork from "gi://AstalNetwork"
import { createBinding } from "ags"

export default function Wireless() {
    const network = AstalNetwork.get_default()
    const wifi = network?.wifi

    // If no wifi hardware is found, return an empty box with size to avoid GTK errors
    if (!wifi) return <box widthRequest={1} heightRequest={1} />

    return (
        <box 
            name="wireless-status"
            cssClasses={["wireless-status"]}
            visible={createBinding(wifi, "enabled")}
            valign={Gtk.Align.CENTER}
        >
            <image 
                // We use iconName from the wifi device itself
                iconName={createBinding(wifi, "iconName", (icon) => icon || "network-wireless-symbolic")}
                // GTK4 needs explicit sizing sometimes to render icons
                pixelSize={16}
                $={(self) => {
                    // Update tooltip based on connection state
                    self.bind("tooltip-text", wifi, "ssid", (ssid) => 
                        ssid ? `Connected to ${ssid}` : "Disconnected"
                    )
                }}
            />
        </box>
    )
}