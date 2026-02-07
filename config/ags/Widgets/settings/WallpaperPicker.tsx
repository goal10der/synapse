import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import { matugenState, execAsync } from "../Settings"; // Adjust path as needed

const WALLPAPER_DIR = `${GLib.get_home_dir()}/Wallpapers`;

export default function WallpaperPicker() {
  const wallpapers: string[] = [];

  try {
    const dir = GLib.Dir.open(WALLPAPER_DIR, 0);
    let name: string | null;
    while ((name = dir.read_name()) !== null) {
      if (
        name.endsWith(".jpg") ||
        name.endsWith(".png") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".gif") ||
        name.endsWith(".JPG") ||
        name.endsWith(".PNG") ||
        name.endsWith(".JPEG") ||
        name.endsWith(".GIF")
      ) {
        wallpapers.push(`${WALLPAPER_DIR}/${name}`);
      }
    }
  } catch (e) {
    console.error(`Wallpaper Directory Error: ${e}`);
  }

  const applyWallpaper = (path: string) => {
    // Now we include the --type flag using the shared variable
    const cmd = `bash -c 'awww img "${path}" -t wipe --transition-duration 3 --transition-bezier .17,.67,.48,1.01 --transition-fps 60 && matugen image --type ${matugenState.currentTonalSpot} "${path}"'`;
    execAsync(cmd)
      .then(() =>
        console.log(`Wallpaper applied with ${matugenState.currentTonalSpot}`),
      )
      .catch(console.error);
  };
  return (
    <Gtk.ScrolledWindow
      heightRequest={400}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      hscrollbarPolicy={Gtk.PolicyType.NEVER}
    >
      <Gtk.Box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["wallpaper-grid"]}
      >
        <Gtk.FlowBox
          maxChildrenPerLine={3}
          minChildrenPerLine={3}
          columnSpacing={10}
          rowSpacing={10}
        >
          {wallpapers.map((path) => (
            <Gtk.Button
              $={(self) => {
                self.connect("clicked", () => applyWallpaper(path));
              }}
              cssClasses={["wallpaper-btn"]}
            >
              <Gtk.Box
                cssClasses={["wallpaper-card"]}
                $={(self: any) => {
                  const provider = new Gtk.CssProvider();
                  provider.load_from_data(
                    `
                                        * { 
                                            background-image: url('file://${path}');
                                            background-size: cover;
                                            background-position: center;
                                            min-width: 160px;
                                            min-height: 90px;
                                            border-radius: 10px;
                                        }
                                    `,
                    -1,
                  );
                  self
                    .get_style_context()
                    .add_provider(
                      provider,
                      Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
                    );
                }}
              />
            </Gtk.Button>
          ))}
        </Gtk.FlowBox>
      </Gtk.Box>
    </Gtk.ScrolledWindow>
  );
}
