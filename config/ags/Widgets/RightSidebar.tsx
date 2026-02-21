import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import AstalWp from "gi://AstalWp?version=0.1";
import Notifd from "gi://AstalNotifd";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Pango from "gi://Pango";
import { onCleanup } from "ags";
import { Variable } from "../utils/Variable";
import { editMode, toggleEditMode } from "../State";
import NetworkPage from "./settings/Network";
import BluetoothPage from "./settings/Bluetooth";
import CalendarWidget, { buildDayView } from "./Calendar";

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

  // ── Sliders ───────────────────────────────────────────────────────────────

  const VolumeSlider = () => (
    <box cssClasses={["qs-slider-container"]} spacing={12}>
      <image iconName="audio-speakers-symbolic" />
      <slider
        hexpand
        onValueChanged={(self) => {
          if (wp?.audio?.defaultSpeaker)
            wp.audio.defaultSpeaker.volume = self.value;
        }}
        $={(self) => {
          const sync = () => {
            if (wp?.audio?.defaultSpeaker)
              self.value = wp.audio.defaultSpeaker.volume;
          };
          sync();
          if (wp?.audio?.defaultSpeaker) {
            const id = wp.audio.defaultSpeaker.connect("notify::volume", sync);
            self.connect("destroy", () =>
              wp.audio?.defaultSpeaker?.disconnect(id),
            );
          }
        }}
      />
    </box>
  );

  const BrightnessSlider = () => (
    <box cssClasses={["qs-slider-container"]} spacing={12}>
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

  // ── Notification center ───────────────────────────────────────────────────

  const NotificationCenter = () => (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["notification-section"]}
      spacing={8}
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
          $={(self) =>
            self.connect("clicked", () =>
              notifd.get_notifications()?.forEach((n) => n.dismiss()),
            )
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
                self.append(
                  (
                    <box cssClasses={["no-notifications"]}>
                      <label label="No notifications" />
                    </box>
                  ) as Gtk.Widget,
                );
                return;
              }

              list.forEach((notif) => {
                const item = (
                  <box
                    cssClasses={["notification-item"]}
                    orientation={Gtk.Orientation.HORIZONTAL}
                    spacing={8}
                  >
                    {notif.image ? makeNotifImageBox(notif.image) : null}
                    <box
                      orientation={Gtk.Orientation.VERTICAL}
                      spacing={3}
                      hexpand
                    >
                      <box spacing={6}>
                        <label
                          label={notif.summary}
                          halign={Gtk.Align.START}
                          hexpand
                          cssClasses={["notification-summary"]}
                          ellipsize={Pango.EllipsizeMode.END}
                          maxWidthChars={22}
                        />
                        <button
                          cssClasses={["dismiss-button"]}
                          $={(b) => b.connect("clicked", () => notif.dismiss())}
                        >
                          <label label="×" />
                        </button>
                      </box>
                      {notif.body && (
                        <label
                          label={notif.body}
                          halign={Gtk.Align.START}
                          wrap
                          useMarkup
                          cssClasses={["notification-body"]}
                          ellipsize={Pango.EllipsizeMode.END}
                          lines={2}
                        />
                      )}
                      {notif.appName && (
                        <label
                          label={notif.appName}
                          halign={Gtk.Align.START}
                          cssClasses={["notification-app"]}
                        />
                      )}
                    </box>
                  </box>
                ) as Gtk.Widget;
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
    // Fixed top section (not scrolled)
    const top = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 14,
    });

    const header = (
      <box cssClasses={["sidebar-header"]} spacing={12} marginBottom={4}>
        <label
          label="Quick Settings"
          hexpand
          xalign={0}
          cssClasses={["sidebar-title"]}
        />
        <button
          cssClasses={["settings-toggle"]}
          onClicked={() => {
            app.toggle_window(`settings-window-${gdkmonitor.connector}`);
            win.hide();
          }}
        >
          <image iconName="emblem-system-symbolic" />
        </button>
        <button
          cssClasses={["powermenu-toggle"]}
          onClicked={() => {
            app.toggle_window(`powermenu-${gdkmonitor.connector}`);
            win.hide();
          }}
        >
          <image iconName="system-shutdown-symbolic" />
        </button>
      </box>
    ) as Gtk.Widget;

    const sliders = (
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        cssClasses={["sliders-section"]}
      >
        <VolumeSlider />
        <BrightnessSlider />
      </box>
    ) as Gtk.Widget;

    const tiles = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 10,
    });

    const editTile = (
      <button
        cssClasses={["qs-tile"]}
        onClicked={() => toggleEditMode()}
        $={(self) => {
          const unsub = editMode.subscribe((v) => {
            if (v) self.add_css_class("active");
            else self.remove_css_class("active");
          });
          onCleanup(unsub);
        }}
      >
        <box spacing={12}>
          <image iconName="view-grid-symbolic" />
          <label
            hexpand
            xalign={0}
            $={(self) => {
              const unsub = editMode.subscribe((v) => {
                self.label = v ? "Exit Edit Mode" : "Edit Layout";
              });
              onCleanup(unsub);
            }}
          />
          <image
            visible={false}
            iconName="object-select-symbolic"
            $={(self) => {
              const unsub = editMode.subscribe((v) => {
                self.visible = v;
              });
              onCleanup(unsub);
            }}
          />
        </box>
      </button>
    ) as Gtk.Widget;

    const wifiTile = (
      <button
        cssClasses={["qs-tile"]}
        onClicked={() => stack.set_visible_child_name("wifi")}
      >
        <box spacing={12}>
          <image iconName="network-wireless-symbolic" />
          <label label="Wi-Fi" hexpand xalign={0} />
          <image iconName="go-next-symbolic" />
        </box>
      </button>
    ) as Gtk.Widget;

    const btTile = (
      <button
        cssClasses={["qs-tile"]}
        onClicked={() => stack.set_visible_child_name("bluetooth")}
      >
        <box spacing={12}>
          <image iconName="bluetooth-symbolic" />
          <label label="Bluetooth" hexpand xalign={0} />
          <image iconName="go-next-symbolic" />
        </box>
      </button>
    ) as Gtk.Widget;

    tiles.append(editTile);
    tiles.append(wifiTile);
    tiles.append(btTile);

    top.append(header);
    top.append(sliders);
    top.append(tiles);

    // Scrollable section: notifications + calendar
    const scroll = new Gtk.ScrolledWindow({
      vexpand: true,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
    });

    const scrollInner = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
    });
    scrollInner.set_margin_top(4);

    scrollInner.append((<NotificationCenter />) as Gtk.Widget);
    scrollInner.append(
      new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL }),
    );

    // Calendar section header
    const calHeader = new Gtk.Box({ spacing: 8, marginBottom: 2 });
    calHeader.append(
      new Gtk.Label({
        label: "Calendar",
        xalign: 0,
        hexpand: true,
        cssClasses: ["cal-section-title"],
      }),
    );
    scrollInner.append(calHeader);

    // The calendar widget — getWin resolves lazily so `win` is always set by the time
    // any dialog is actually opened.
    scrollInner.append(
      CalendarWidget(getWin, (date) => {
        // Rebuild the day view page for the clicked date, then navigate to it
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

  // ── Back-button factory ───────────────────────────────────────────────────

  const BackBtn = () =>
    (
      <button
        onClicked={() => stack.set_visible_child_name("main")}
        halign={Gtk.Align.START}
        cssClasses={["back-button"]}
      >
        <box spacing={8}>
          <image iconName="go-previous-symbolic" />
          <label label="Back" />
        </box>
      </button>
    ) as Gtk.Widget;

  // ── Wi-Fi page ────────────────────────────────────────────────────────────

  const wifiPage = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
      <BackBtn />
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <NetworkPage />
        </box>
      </scrolledwindow>
    </box>
  ) as Gtk.Widget;

  // ── Bluetooth page ────────────────────────────────────────────────────────

  const btPage = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
      <BackBtn />
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <BluetoothPage />
        </box>
      </scrolledwindow>
    </box>
  ) as Gtk.Widget;

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
        widthRequest={350}
      >
        <stack
          $={(self) => {
            stack = self;
            self.add_named(buildMainPage(), "main");
            self.add_named(wifiPage, "wifi");
            self.add_named(btPage, "bluetooth");
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
