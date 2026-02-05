import Hyprland from "gi://AstalHyprland"
import Gtk from "gi://Gtk?version=4.0"
import { createBinding } from "ags"

export default function Workspaces() {
    const hypr = Hyprland.get_default()
    const focused = createBinding(hypr, "focused-workspace")

    // The 5 dots we want to draw
    const dots = [1, 2, 3, 4, 5]

    return <box 
        cssClasses={["workspaces-container"]} 
        halign={Gtk.Align.CENTER}
    >
        {dots.map(id => (
            <box 
                // This binding returns ["dot", "active"] or just ["dot"]
                cssClasses={focused(ws => {
                    const classes = ["dot"]
                    if (ws.id === id) classes.push("active")
                    return classes
                })} 
            />
        ))}
    </box>
}