import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Cairo from "gi://cairo";

const VERSION_FILE = `${GLib.get_user_config_dir()}/ags/.synapse-version`;
const REPO_API =
  "https://api.github.com/repos/goal10der/synapse/commits?per_page=1";
const REPO_URL = "https://github.com/goal10der/synapse";

// ── helpers ───────────────────────────────────────────────────────────────────

function getLocalCommit(): string {
  try {
    const file = Gio.File.new_for_path(VERSION_FILE);
    const [ok, contents] = file.load_contents(null);
    if (ok && contents) return new TextDecoder().decode(contents).trim();
  } catch (_) {}
  return "";
}

async function getRemoteCommit(): Promise<string> {
  return new Promise((resolve) => {
    try {
      const session = new Gio.NetworkAddress();
      // Use subprocess to curl — avoids needing libsoup bindings
      const launcher = new Gio.SubprocessLauncher({
        flags:
          Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      });
      const proc = launcher.spawnv([
        "curl",
        "-sf",
        "--max-time",
        "8",
        "-H",
        "Accept: application/vnd.github.v3+json",
        REPO_API,
      ]);
      proc.communicate_utf8_async(null, null, (_p, res) => {
        try {
          const [, stdout] = proc.communicate_utf8_finish(res);
          if (!stdout) return resolve("");
          const data = JSON.parse(stdout);
          const sha: string = Array.isArray(data)
            ? (data[0]?.sha ?? "")
            : (data?.sha ?? "");
          resolve(sha);
        } catch (_) {
          resolve("");
        }
      });
    } catch (_) {
      resolve("");
    }
  });
}

function openUrl(url: string) {
  try {
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.NONE,
    });
    launcher.spawnv(["xdg-open", url]);
  } catch (_) {}
}

// ── component ─────────────────────────────────────────────────────────────────

export default function UpdatePopup({ gdkmonitor }: { gdkmonitor: any }) {
  let timeoutId: number | null = null;

  const dismiss = (revealer: Gtk.Revealer, window: Gtk.Window) => {
    if (timeoutId) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
    revealer.reveal_child = false;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
      window.set_visible(false);
      return GLib.SOURCE_REMOVE;
    });
  };

  const init = (revealer: Gtk.Revealer) => {
    const window = revealer.get_root() as Gtk.Window;
    if (!window) return;

    const local = getLocalCommit();

    // Only check if a version file exists (installed via install.sh)
    if (!local || local === "unknown") return;

    getRemoteCommit().then((remote) => {
      if (!remote || remote.startsWith(local) || local.startsWith(remote))
        return;

      // Behind — show the popup
      window.set_visible(true);
      revealer.reveal_child = true;

      // Auto-dismiss after 12 seconds
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12000, () => {
        dismiss(revealer, window);
        return GLib.SOURCE_REMOVE;
      });
    });

    revealer.connect("destroy", () => {
      if (timeoutId) GLib.source_remove(timeoutId);
    });
  };

  return (
    <window
      gdkmonitor={gdkmonitor}
      name={`update-popup-${gdkmonitor.connector}`}
      cssClasses={["update-popup-window"]}
      namespace="update-popup"
      anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      visible={false}
      $={(self) => {
        // Pass all input through so bar/other windows still work
        const region = new Cairo.Region();
        self.input_region = region;
      }}
    >
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        reveal_child={false}
        transitionDuration={300}
        valign={Gtk.Align.START}
        halign={Gtk.Align.END}
        $={(self) => {
          // Wait for widget tree to be fully realised before checking
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            // Re-enable input region for just our popup card
            const win = self.get_root() as any;
            if (win) win.input_region = null;
            init(self);
            return GLib.SOURCE_REMOVE;
          });
        }}
      >
        <box
          cssClasses={["update-popup"]}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={10}
        >
          {/* Header */}
          <box spacing={10}>
            <image
              iconName="software-update-available-symbolic"
              cssClasses={["update-popup-icon"]}
              valign={Gtk.Align.CENTER}
            />
            <box
              orientation={Gtk.Orientation.VERTICAL}
              spacing={2}
              hexpand
              valign={Gtk.Align.CENTER}
            >
              <label
                label="Update available"
                xalign={0}
                cssClasses={["update-popup-title"]}
              />
              <label
                label="A new version of Synapse is ready"
                xalign={0}
                cssClasses={["update-popup-body"]}
              />
            </box>
            <button
              cssClasses={["notification-popup-close"]}
              valign={Gtk.Align.START}
              $={(self) => {
                self.connect("clicked", () => {
                  const rev = self.get_parent()!.get_parent() as Gtk.Revealer;
                  const win = rev.get_root() as Gtk.Window;
                  dismiss(rev, win);
                });
              }}
            >
              <label label="×" />
            </button>
          </box>

          {/* Action buttons */}
          <box spacing={8} halign={Gtk.Align.END}>
            <button
              cssClasses={["update-popup-later"]}
              $={(self) => {
                self.connect("clicked", () => {
                  const rev = self.get_parent()!.get_parent() as Gtk.Revealer;
                  const win = rev.get_root() as Gtk.Window;
                  dismiss(rev, win);
                });
              }}
            >
              <label label="Later" />
            </button>
            <button
              cssClasses={["update-popup-view"]}
              $={(self) => {
                self.connect("clicked", () => {
                  openUrl(REPO_URL);
                  const rev = self.get_parent()!.get_parent() as Gtk.Revealer;
                  const win = rev.get_root() as Gtk.Window;
                  dismiss(rev, win);
                });
              }}
            >
              <label label="View on GitHub" />
            </button>
          </box>
        </box>
      </revealer>
    </window>
  );
}
