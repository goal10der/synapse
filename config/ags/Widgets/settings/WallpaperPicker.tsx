import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import { onCleanup } from "ags";
import { matugenState, execAsync } from "../Settings";

const WALLPAPER_DIR = `${GLib.get_home_dir()}/Wallpapers`;

export default function WallpaperPicker() {
  let flowBoxRef: Gtk.FlowBox | null = null;
  let currentWallpapers: string[] = [];
  let monitorSignalId: number | null = null;

  // Debounce lock to prevent multiple simultaneous heavy reloads
  let isApplying = false;

  const applyWallpaper = (path: string) => {
    if (isApplying) return;
    isApplying = true;

    const name = path.split("/").pop() ?? "wallpaper";

    // We add '&' at the end of the matugen command so it doesn't block
    // and use 'nohup' or similar logic to let it finish in the background
    const cmd = `bash -c 'awww img "${path}" -t wipe --transition-duration 3 --transition-fps 60 && matugen image --type ${matugenState.currentTonalSpot} "${path}" &'`;

    execAsync(cmd)
      .then(() => {
        console.log(`Wallpaper application started...`);
        GLib.spawn_command_line_async(
          `notify-send "Theming Started" "Applying ${name}..." -i "${path}" -t 2000`,
        );
      })
      .catch((err) => {
        console.error(err);
      })
      .finally(() => {
        // Release the lock after a short delay to prevent spamming
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
          isApplying = false;
          return GLib.SOURCE_REMOVE;
        });
      });
  };

  const createWallpaperButton = (path: string): Gtk.Button => {
    const button = new Gtk.Button();
    button.set_css_classes(["wallpaper-btn"]);
    button.connect("clicked", () => applyWallpaper(path));

    const box = new Gtk.Box();
    box.set_css_classes(["wallpaper-card"]);

    const provider = new Gtk.CssProvider();
    provider.load_from_data(
      `* { 
        background-image: url('file://${path}');
        background-size: cover;
        background-position: center;
        min-width: 160px;
        min-height: 150px;
        border-radius: 10px;
      }`,
      -1,
    );
    box
      .get_style_context()
      .add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    button.set_child(box);
    return button;
  };

  const loadWallpapers = () => {
    const wallpapers: string[] = [];
    let dir: any = null;
    try {
      dir = GLib.Dir.open(WALLPAPER_DIR, 0);
      let name: string | null;
      while ((name = dir.read_name()) !== null) {
        if (/\.(jpg|jpeg|png|gif|JPG|PNG|JPEG|GIF)$/.test(name)) {
          wallpapers.push(`${WALLPAPER_DIR}/${name}`);
        }
      }
    } catch (e) {
      console.error(`Wallpaper Directory Error: ${e}`);
    } finally {
      if (dir) dir.close();
    }
    return wallpapers.sort();
  };

  const updateGrid = () => {
    if (!flowBoxRef) return;
    const newWallpapers = loadWallpapers();
    if (JSON.stringify(currentWallpapers) === JSON.stringify(newWallpapers))
      return;

    currentWallpapers = newWallpapers;
    while (flowBoxRef.get_first_child()) {
      flowBoxRef.remove(flowBoxRef.get_first_child()!);
    }
    newWallpapers.forEach((path) => {
      flowBoxRef!.append(createWallpaperButton(path));
    });
  };

  // File Monitor Setup
  let fileMonitor: any = null;
  try {
    const file = Gio.File.new_for_path(WALLPAPER_DIR);
    fileMonitor = file.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    monitorSignalId = fileMonitor.connect(
      "changed",
      (_m: any, _f: any, _o: any, event: number) => {
        if (
          event === Gio.FileMonitorEvent.CREATED ||
          event === Gio.FileMonitorEvent.DELETED
        ) {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            updateGrid();
            return GLib.SOURCE_REMOVE;
          });
        }
      },
    );
  } catch (e) {
    console.error(e);
  }

  onCleanup(() => {
    if (monitorSignalId && fileMonitor) fileMonitor.disconnect(monitorSignalId);
  });

  return (
    <Gtk.ScrolledWindow
      heightRequest={400}
      vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
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
            currentWallpapers.forEach((path) =>
              self.append(createWallpaperButton(path)),
            );
          }}
        />
      </Gtk.Box>
    </Gtk.ScrolledWindow>
  );
}
