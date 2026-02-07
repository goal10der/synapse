import Astal from "gi://Astal?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { onCleanup } from "ags";
import app from "ags/gtk4/app";
import Notifd from "gi://AstalNotifd";

export default function NotificationCenter({
  gdkmonitor,
}: {
  gdkmonitor: Gdk.Monitor;
}) {
  let win: Astal.Window;
  const { TOP, RIGHT } = Astal.WindowAnchor;
  const notifd = Notifd.get_default();

  onCleanup(() => {
    win.destroy();
  });

  const window = (
    <window
      $={(self) => {
        win = self;
        app.add_window(self);
      }}
      visible={false}
      namespace="notification-center"
      name={`notification-center-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.NORMAL}
      anchor={TOP | RIGHT}
      application={app}
      cssClasses={["notification-center"]}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["notification-center-content"]}
      >
        <box cssClasses={["header"]}>
          <label label="Notifications" halign={Gtk.Align.START} />
          <box hexpand />
          <button
            $={(self) => {
              self.connect("clicked", () => {
                notifd.get_notifications().forEach((n) => n.dismiss());
              });
            }}
            cssClasses={["clear-all"]}
          >
            <label label="Clear All" />
          </button>
        </box>

        <Gtk.ScrolledWindow vexpand cssClasses={["notification-list"]}>
          <box
            orientation={Gtk.Orientation.VERTICAL}
            $={(self) => {
              const updateNotifications = () => {
                // Clear existing children using GTK4 API
                let child = self.get_first_child();
                while (child) {
                  const next = child.get_next_sibling();
                  self.remove(child);
                  child = next;
                }

                const notifications = notifd.get_notifications();

                if (notifications.length === 0) {
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
                        orientation={Gtk.Orientation.VERTICAL}
                      >
                        <box>
                          <label
                            label={notification.summary}
                            halign={Gtk.Align.START}
                            cssClasses={["notification-summary"]}
                          />
                          <box hexpand />
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
                            cssClasses={["notification-body"]}
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
                    ) as Gtk.Widget;
                    self.append(notifBox);
                  });
                }
              };

              // Initial update
              updateNotifications();

              // Listen for notification changes
              const notifiedId = notifd.connect(
                "notified",
                updateNotifications,
              );
              const resolvedId = notifd.connect(
                "resolved",
                updateNotifications,
              );

              // Cleanup
              self.connect("destroy", () => {
                notifd.disconnect(notifiedId);
                notifd.disconnect(resolvedId);
              });
            }}
          />
        </Gtk.ScrolledWindow>
      </box>
    </window>
  );

  return window;
}
