import GLib from "gi://GLib";
import Gtk from "gi://Gtk?version=4.0";
import Gio from "gi://Gio";
import { onCleanup } from "ags";
import {
  matugenState,
  execAsync,
  setLastWallpaperPath,
  runMatugen,
} from "../Settings";

const WALLPAPER_DIR = `${GLib.get_home_dir()}/Wallpapers`;
const THUMB_DIR = `${GLib.get_user_cache_dir()}/ags/wallpaper-thumbs`;

// Ensure thumbnail cache dir exists
GLib.mkdir_with_parents(THUMB_DIR, 0o755);

const VIDEO_EXTS =
  /\.(gif|mp4|mkv|mov|avi|webm|flv|wmv|m4v|GIF|MP4|MKV|MOV|AVI|WEBM|FLV|WMV|M4V)$/;
const ALL_EXTS =
  /\.(jpg|jpeg|png|gif|mp4|mkv|mov|avi|webm|flv|wmv|m4v|JPG|JPEG|PNG|GIF|MP4|MKV|MOV|AVI|WEBM|FLV|WMV|M4V)$/;

function commandExists(cmd: string): boolean {
  try {
    const [ok, out] = GLib.spawn_command_line_sync(`which ${cmd}`);
    return ok && !!out && new TextDecoder().decode(out).trim().length > 0;
  } catch (_) {
    return false;
  }
}

function thumbPath(videoPath: string): string {
  // Use a hash of the full path as filename to avoid collisions
  const name = videoPath.replace(/\//g, "_").replace(/^_/, "") + ".jpg";
  return `${THUMB_DIR}/${name}`;
}

function applyThumbCss(box: Gtk.Box, imgPath: string) {
  const provider = new Gtk.CssProvider();
  provider.load_from_data(
    `* {
      background-image: url('file://${imgPath}');
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
}

async function ensureThumb(videoPath: string): Promise<string | null> {
  const thumb = thumbPath(videoPath);
  if (GLib.file_test(thumb, GLib.FileTest.EXISTS)) return thumb;

  // ffmpeg: grab frame at 1 second, scale to 320px wide, single frame output
  return new Promise((resolve) => {
    try {
      const launcher = new Gio.SubprocessLauncher({
        flags:
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      });
      const proc = launcher.spawnv([
        "ffmpeg",
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        videoPath,
        "-vframes",
        "1",
        "-vf",
        "scale=320:-1",
        thumb,
      ]);
      proc.wait_async(null, (_p, res) => {
        try {
          proc.wait_finish(res);
          const ok =
            proc.get_exit_status() === 0 &&
            GLib.file_test(thumb, GLib.FileTest.EXISTS);
          resolve(ok ? thumb : null);
        } catch (_) {
          resolve(null);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

export default function WallpaperPicker() {
  let flowBoxRef: Gtk.FlowBox | null = null;
  let currentWallpapers: string[] = [];
  let monitorSignalId: number | null = null;
  let isApplying = false;

  const applyWallpaper = (path: string) => {
    if (isApplying) return;
    isApplying = true;

    const name = path.split("/").pop() ?? "wallpaper";

    if (VIDEO_EXTS.test(path)) {
      // ── video / GIF → mpvpaper ─────────────────────────────────────────
      if (!commandExists("mpvpaper")) {
        GLib.spawn_command_line_async(
          `notify-send "mpvpaper not installed" "Install mpvpaper to use video and GIF wallpapers." -i dialog-error -t 5000`,
        );
        isApplying = false;
        return;
      }

      execAsync(
        `bash -c 'pkill -x mpvpaper; awww clear; sleep 0.2; mpvpaper "*" "${path}" --mpv-options "no-audio loop"; matugen image --type ${matugenState.currentTonalSpot} "${path}" --source-color-index 0'`,
      )
        .then(() => {
          setLastWallpaperPath(path);
          runMatugen(matugenState.currentTonalSpot, path);
          GLib.spawn_command_line_async(
            `notify-send "Wallpaper Applied" "${name}" -t 2000`,
          );
        })
        .catch((err) => console.error(err))
        .finally(() => {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            isApplying = false;
            return GLib.SOURCE_REMOVE;
          });
        });
    } else {
      // ── static image → awww + matugen ─────────────────────────────────
      // Kill any running mpvpaper so it doesn't sit on top of awww
      execAsync(`bash -c 'pkill -x mpvpaper; true'`).catch(() => {});

      // Remember this path so the tonal-spot dropdown can re-run matugen later
      setLastWallpaperPath(path);

      const cmd = `bash -c 'awww img "${path}" -t wipe --transition-duration 3 --transition-fps 60 && matugen image --type ${matugenState.currentTonalSpot} "${path}" --source-color-index 0 &'`;
      execAsync(cmd)
        .then(() => {
          GLib.spawn_command_line_async(
            `notify-send "Theming Started" "Applying ${name}..." -i "${path}" -t 2000`,
          );
        })
        .catch((err) => console.error(err))
        .finally(() => {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            isApplying = false;
            return GLib.SOURCE_REMOVE;
          });
        });
    }
  };

  const createWallpaperButton = (path: string): Gtk.Button => {
    const button = new Gtk.Button();
    button.set_css_classes(["wallpaper-btn"]);
    button.connect("clicked", () => applyWallpaper(path));

    const box = new Gtk.Box();
    box.set_css_classes(["wallpaper-card"]);

    if (VIDEO_EXTS.test(path)) {
      box.set_size_request(160, 150);

      // Check if thumb already exists — apply immediately, else show placeholder
      const thumb = thumbPath(path);
      if (GLib.file_test(thumb, GLib.FileTest.EXISTS)) {
        applyThumbCss(box, thumb);

        // Play badge overlay
        const overlay = new Gtk.Overlay();
        overlay.set_child(box);
        const badge = new Gtk.Image({
          iconName: "media-playback-start-symbolic",
          pixelSize: 24,
          halign: Gtk.Align.END,
          valign: Gtk.Align.END,
          marginEnd: 6,
          marginBottom: 6,
          cssClasses: ["wallpaper-video-play-badge"],
        });
        overlay.add_overlay(badge);
        button.set_child(overlay);
        return button;
      }

      // Placeholder while ffmpeg runs
      box.set_orientation(Gtk.Orientation.VERTICAL);
      box.set_spacing(6);
      box.set_halign(Gtk.Align.CENTER);
      box.set_valign(Gtk.Align.CENTER);
      const spinner = new Gtk.Spinner();
      spinner.start();
      box.append(spinner);
      const extLbl = new Gtk.Label({
        label: (path.split(".").pop() ?? "").toUpperCase(),
      });
      extLbl.add_css_class("dim-label");
      box.append(extLbl);

      button.set_child(box);

      // Generate thumbnail asynchronously then swap in
      ensureThumb(path).then((t) => {
        if (!t) {
          // ffmpeg failed or not installed — fall back to play icon
          spinner.stop();
          while (box.get_first_child()) box.remove(box.get_first_child()!);
          box.append(
            new Gtk.Image({
              iconName: "media-playback-start-symbolic",
              pixelSize: 32,
            }),
          );
          box.append(extLbl);
          return;
        }

        // Replace box contents with thumbnail CSS + badge overlay
        applyThumbCss(box, t);
        box.set_orientation(Gtk.Orientation.HORIZONTAL);
        box.set_spacing(0);
        box.set_halign(Gtk.Align.FILL);
        box.set_valign(Gtk.Align.FILL);
        while (box.get_first_child()) box.remove(box.get_first_child()!);

        const overlay = new Gtk.Overlay();
        const inner = new Gtk.Box();
        inner.set_size_request(160, 150);
        overlay.set_child(inner);
        const badge = new Gtk.Image({
          iconName: "media-playback-start-symbolic",
          pixelSize: 24,
          halign: Gtk.Align.END,
          valign: Gtk.Align.END,
          marginEnd: 6,
          marginBottom: 6,
          cssClasses: ["wallpaper-video-play-badge"],
        });
        overlay.add_overlay(badge);
        button.set_child(overlay);
      });

      return button;
    } else {
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
    }

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
        if (ALL_EXTS.test(name)) wallpapers.push(`${WALLPAPER_DIR}/${name}`);
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
    while (flowBoxRef.get_first_child())
      flowBoxRef.remove(flowBoxRef.get_first_child()!);
    newWallpapers.forEach((path) =>
      flowBoxRef!.append(createWallpaperButton(path)),
    );
  };

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
