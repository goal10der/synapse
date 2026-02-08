import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import { matugenState, execAsync } from "../Settings";

const WALLPAPER_DIR = `${GLib.get_home_dir()}/Wallpapers`;
const POLL_INTERVAL = 2000; // Check every 2 seconds

const loadWallpapers = () => {
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
  return wallpapers.sort();
};

export default function WallpaperPicker() {
  let flowBoxRef: Gtk.FlowBox | null = null;
  let currentWallpapers: string[] = [];
  let pollTimeoutId: number | null = null;

  const applyWallpaper = (path: string) => {
    const cmd = `bash -c 'awww img "${path}" -t wipe --transition-duration 3 --transition-bezier .17,.67,.48,1.01 --transition-fps 60 && matugen image --type ${matugenState.currentTonalSpot} "${path}"'`;
    execAsync(cmd)
      .then(() =>
        console.log(`Wallpaper applied with ${matugenState.currentTonalSpot}`),
      )
      .catch(console.error);
  };

  const createWallpaperButton = (path: string): Gtk.Button => {
    const button = new Gtk.Button();
    button.set_css_classes(["wallpaper-btn"]);
    button.connect("clicked", () => applyWallpaper(path));

    const box = new Gtk.Box();
    box.set_css_classes(["wallpaper-card"]);

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
    box
      .get_style_context()
      .add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    button.set_child(box);
    return button;
  };

  const updateGrid = () => {
    if (!flowBoxRef) return;

    const newWallpapers = loadWallpapers();

    // Check if wallpapers changed
    if (JSON.stringify(currentWallpapers) === JSON.stringify(newWallpapers)) {
      return;
    }

    console.log(
      `Wallpapers changed: ${currentWallpapers.length} -> ${newWallpapers.length}`,
    );
    currentWallpapers = newWallpapers;

    // Remove all children
    while (flowBoxRef.get_first_child()) {
      const child = flowBoxRef.get_first_child();
      if (child) {
        flowBoxRef.remove(child);
      }
    }

    // Add new buttons
    newWallpapers.forEach((path) => {
      flowBoxRef!.append(createWallpaperButton(path));
    });
  };

  const startPolling = () => {
    const poll = () => {
      updateGrid();
      pollTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        POLL_INTERVAL,
        () => {
          poll();
          return GLib.SOURCE_REMOVE;
        },
      ) as any;
    };
    poll();
  };

  // Try file monitoring first, fall back to polling
  let monitorActive = false;
  try {
    const file = Gio.File.new_for_path(WALLPAPER_DIR);
    const monitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);

    monitor.connect("changed", (_monitor, file, otherFile, eventType) => {
      if (
        eventType === Gio.FileMonitorEvent.CREATED ||
        eventType === Gio.FileMonitorEvent.DELETED ||
        eventType === Gio.FileMonitorEvent.MOVED_IN ||
        eventType === Gio.FileMonitorEvent.MOVED_OUT ||
        eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT
      ) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          updateGrid();
          return GLib.SOURCE_REMOVE;
        });
      }
    });

    monitorActive = true;
    console.log(`File monitor active for: ${WALLPAPER_DIR}`);
  } catch (e) {
    console.error(`File monitor failed, using polling: ${e}`);
  }

  // Always use polling as backup
  if (!monitorActive) {
    console.log(`Starting polling mode (every ${POLL_INTERVAL}ms)`);
  }

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
          $={(self) => {
            flowBoxRef = self;
            currentWallpapers = loadWallpapers();
            console.log(`Initial load: ${currentWallpapers.length} wallpapers`);

            // Initial population
            currentWallpapers.forEach((path) => {
              self.append(createWallpaperButton(path));
            });

            // Start polling
            startPolling();
          }}
        />
      </Gtk.Box>
    </Gtk.ScrolledWindow>
  );
}
