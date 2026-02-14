import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import AstalWp from "gi://AstalWp?version=0.1";
import Notifd from "gi://AstalNotifd";
import Gdk from "gi://Gdk?version=4.0";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Pango from "gi://Pango";
import { onCleanup } from "ags";
import { editMode, toggleEditMode } from "../State";
import NetworkPage from "./settings/Network";
import BluetoothPage from "./settings/Bluetooth";

function exec(cmd: string): string {
  try {
    const [success, stdout] = GLib.spawn_command_line_sync(cmd);
    if (success) return new TextDecoder().decode(stdout).trim();
  } catch (e) {
    console.error(e);
  }
  return "";
}

async function execAsync(cmd: string): Promise<string> {
  const launcher = new Gio.SubprocessLauncher({
    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
  });
  const argv = GLib.shell_parse_argv(cmd)[1];
  const proc = launcher.spawnv(argv);
  return new Promise((resolve) => {
    proc.communicate_utf8_async(null, null, (p, res) => {
      const [_, stdout] = p!.communicate_utf8_finish(res);
      resolve(stdout ? stdout.trim() : "");
    });
  });
}

/* --- STATE HELPER --- */
function createVar<T>(initialValue: T) {
  let value = initialValue;
  const listeners = new Set<(val: T) => void>();
  return {
    get: () => value,
    set: (val: T) => {
      if (value !== val) {
        value = val;
        listeners.forEach((l) => l(val));
      }
    },
    subscribe: (cb: (val: T) => void) => {
      listeners.add(cb);
      cb(value);
      return () => listeners.delete(cb);
    },
  };
}

const wp = AstalWp.get_default();
const maxBrightness = Number(exec("brightnessctl max")) || 100;
const brightness = createVar(0);

GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
  execAsync("brightnessctl get").then((out) =>
    brightness.set(Number(out) / maxBrightness),
  );
  return true;
});

export default function RightSidebar({
  gdkmonitor,
}: {
  gdkmonitor: Gdk.Monitor;
}) {
  let win: Astal.Window;
  let stack: Gtk.Stack;
  const notifd = Notifd.get_default();

  /* --- UI COMPONENTS --- */

  const Header = () => (
    <box cssClasses={["sidebar-header"]} spacing={12} marginBottom={8}>
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
  );

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
            const signalId = wp.audio.defaultSpeaker.connect(
              "notify::volume",
              sync,
            );
            self.connect("destroy", () => {
              wp.audio?.defaultSpeaker?.disconnect(signalId);
            });
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
          onCleanup(unsub);
        }}
      />
    </box>
  );

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
          $={(self) => {
            self.connect("clicked", () => {
              const notifications = notifd.get_notifications();
              if (notifications) {
                notifications.forEach((n) => n.dismiss());
              }
            });
          }}
          cssClasses={["clear-all"]}
        >
          <label label="Clear All" />
        </button>
      </box>

      <Gtk.ScrolledWindow
        vexpand
        maxContentHeight={400}
        cssClasses={["notification-list"]}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={8}
          $={(self) => {
            const updateNotifications = () => {
              let child = self.get_first_child();
              while (child) {
                const next = child.get_next_sibling();
                self.remove(child);
                child = next;
              }

              const notifications = notifd.get_notifications();

              if (!notifications || notifications.length === 0) {
                const emptyBox = (
                  <box cssClasses={["no-notifications"]}>
                    <label label="No notifications" />
                  </box>
                ) as Gtk.Widget;
                self.append(emptyBox);
              } else {
                notifications.forEach((notification) => {
                  const notifBox = (
                    <box
                      cssClasses={["notification-item"]}
                      orientation={Gtk.Orientation.HORIZONTAL}
                      spacing={10}
                    >
                      {notification.image && (
                        // Inside NotificationCenter -> notification.image block:
                        <box
                          cssClasses={["notification-image-wrapper"]}
                          widthRequest={44}
                          heightRequest={44}
                          valign={Gtk.Align.CENTER} // <--- Add this: keeps it a square/circle, not an oval
                          halign={Gtk.Align.CENTER}
                          hexpand={false} // <--- Add this: prevents horizontal stretching
                          vexpand={false} // <--- Add this: prevents vertical stretching
                          $={(self) => {
                            try {
                              const pixbuf =
                                GdkPixbuf.Pixbuf.new_from_file_at_scale(
                                  notification.image,
                                  48,
                                  48,
                                  false,
                                );
                              const texture =
                                Gdk.Texture.new_for_pixbuf(pixbuf);
                              const picture = new Gtk.Picture();
                              picture.set_paintable(texture);
                              picture.set_size_request(44, 44);
                              picture.set_can_shrink(false); // Prevents the image itself from collapsing
                              self.append(picture);
                            } catch (e) {
                              console.error("Failed to load image:", e);
                            }
                          }}
                        />
                      )}

                      <box
                        orientation={Gtk.Orientation.VERTICAL}
                        spacing={4}
                        hexpand
                      >
                        <box spacing={8}>
                          <label
                            label={notification.summary}
                            halign={Gtk.Align.START}
                            cssClasses={["notification-summary"]}
                            hexpand
                            // 3. Add Ellipsization for Summary
                            ellipsize={Pango.EllipsizeMode.END}
                            maxWidthChars={20}
                          />
                          <button
                            $={(btn) => {
                              btn.connect("clicked", () => {
                                notification.dismiss();
                              });
                            }}
                            cssClasses={["dismiss-button"]}
                          >
                            <label label="×" />
                          </button>
                        </box>

                        {notification.body && (
                          <label
                            label={notification.body}
                            halign={Gtk.Align.START}
                            wrap
                            useMarkup
                            cssClasses={["notification-body"]}
                            ellipsize={Pango.EllipsizeMode.END}
                            lines={2}
                          />
                        )}

                        {notification.appName && (
                          <label
                            label={notification.appName}
                            halign={Gtk.Align.START}
                            cssClasses={["notification-app"]}
                          />
                        )}
                      </box>
                    </box>
                  ) as Gtk.Widget;
                  self.append(notifBox);
                });
              }
            };
            updateNotifications();
            const notifiedId = notifd.connect("notified", updateNotifications);
            const resolvedId = notifd.connect("resolved", updateNotifications);
            self.connect("destroy", () => {
              notifd.disconnect(notifiedId);
              notifd.disconnect(resolvedId);
            });
          }}
        />
      </Gtk.ScrolledWindow>
    </box>
  );

  const mainPage = (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      spacing={16}
      cssClasses={["main-sidebar-page"]}
      vexpand
    >
      <box orientation={Gtk.Orientation.VERTICAL} spacing={16} vexpand={false}>
        <Header />

        <box
          orientation={Gtk.Orientation.VERTICAL}
          spacing={8}
          cssClasses={["sliders-section"]}
        >
          <VolumeSlider />
          <BrightnessSlider />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
          <button
            cssClasses={["qs-tile"]}
            onClicked={() => toggleEditMode()}
            $={(self) => {
              const unsub = editMode.subscribe((active) => {
                if (active) self.add_css_class("active");
                else self.remove_css_class("active");
              });
              onCleanup(unsub);
            }}
          >
            <box spacing={12}>
              <image iconName="view-grid-symbolic" />
              <label
                label="Edit Layout"
                hexpand
                xalign={0}
                $={(self) => {
                  const unsub = editMode.subscribe(
                    (v) => (self.label = v ? "Exit Edit Mode" : "Edit Layout"),
                  );
                  onCleanup(unsub);
                }}
              />
              <image
                visible={false}
                iconName="object-select-symbolic"
                $={(self) => {
                  const unsub = editMode.subscribe((v) => (self.visible = v));
                  onCleanup(unsub);
                }}
              />
            </box>
          </button>

          <button
            cssClasses={["qs-tile"]}
            onClicked={() => stack.set_visible_child_name("wifi")}
          >
            <box spacing={12}>
              <image iconName="network-wireless-symbolic" />
              <label label="Wi-Fi Settings" hexpand xalign={0} />
              <image iconName="go-next-symbolic" />
            </box>
          </button>
          <button
            cssClasses={["qs-tile"]}
            onClicked={() => stack.set_visible_child_name("bluetooth")}
          >
            <box spacing={12}>
              <image iconName="bluetooth-symbolic" />
              <label label="Bluetooth Settings" hexpand xalign={0} />
              <image iconName="go-next-symbolic" />
            </box>
          </button>
        </box>
      </box>

      {/* Notification Center - takes remaining space */}
      <NotificationCenter />
    </box>
  );

  const wifiPageContainer = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
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
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <NetworkPage />
        </box>
      </scrolledwindow>
    </box>
  );

  const bluetoothPageContainer = (
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12} vexpand>
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
      <scrolledwindow vexpand hscrollbarPolicy={Gtk.PolicyType.NEVER}>
        <box orientation={Gtk.Orientation.VERTICAL}>
          <BluetoothPage />
        </box>
      </scrolledwindow>
    </box>
  );

  /* --- WINDOW --- */

  return (
    <window
      $={(self) => {
        win = self;
        const keys = new Gtk.EventControllerKey();
        keys.connect("key-pressed", (_, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
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
            self.add_named(mainPage, "main");
            self.add_named(wifiPageContainer, "wifi");
            self.add_named(bluetoothPageContainer, "bluetooth");
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
