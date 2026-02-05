import Gtk from "gi://Gtk?version=4.0"
import WallpaperPicker from "./WallpaperPicker"
// Import the state object instead of the let variable
import { matugenState, runMatugen } from "../Settings" 

export default function AppearancePage({ scaleFactor }: { scaleFactor: number }) {
    const tonalSpots = ["scheme-content", "scheme-expressive", "scheme-fidelity", "scheme-fruit-salad", "scheme-monochrome", "scheme-neutral", "scheme-rainbow", "scheme-tonal-spot", "scheme-vibrant"]
    const tonalSpotsName = ["content", "expressive", "fidelity", "fruit salad", "monochrome", "neutral", "rainbow", "tonal spot", "vibrant"]

    return (
        <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={20} cssClasses={["page-container"]}>
            <Gtk.Label label="Appearance" xalign={0} cssClasses={["page-title"]} />
            
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <Gtk.Label label="MATUGEN TONAL SPOT" xalign={0} cssClasses={["section-title"]} />
                
                {/* The Container */}
                <Gtk.Box halign={Gtk.Align.START} valign={Gtk.Align.START}>
                    <Gtk.DropDown 
                        cssClasses={["tonal-dropdown"]}
                        widthRequest={80}  // 80px is safer for words like "fruit salad"
                        heightRequest={20} // Forced 20px height
                        valign={Gtk.Align.CENTER} // KEY: Prevents the button from stretching vertically
                        model={Gtk.StringList.new(tonalSpotsName)}
                        $={(self) => {
                            // Use the object property here
                            self.selected = tonalSpots.indexOf(matugenState.currentTonalSpot);
                            
                            self.connect("notify::selected", () => {
                                const selected = tonalSpots[self.selected];
                                runMatugen(selected); 
                            });
                        }}
                    />
                </Gtk.Box>
            </Gtk.Box>

            <Gtk.Label label="WALLPAPERS" xalign={0} cssClasses={["section-title"]} />
            <WallpaperPicker />
        </Gtk.Box>
    )
}