import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Notifd from "gi://AstalNotifd";
import { onCleanup, createState, For, createBinding } from "ags";
import app from "ags/gtk4/app";
import GLib from "gi://GLib";
import { notificationTimeout } from "./settings/Appearance";

function Notification({ notification }: { notification: Notifd.Notification }) {
  // Auto-dismiss after timeout
  const timeoutId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    notificationTimeout.get(),
    () => {
      notification.dismiss();
      return false; // Don't repeat
    },
  );

  // Cleanup timeout if notification is manually dismissed
  notification.connect("resolved", () => {
    if (timeoutId > 0) {
      GLib.source_remove(timeoutId);
    }
  });

  return (
    <box
      cssClasses={["notification-popup"]}
      orientation={Gtk.Orientation.VERTICAL}
    >
      <box cssClasses={["notification-popup-header"]}>
        <label
          label={notification.summary}
          halign={Gtk.Align.START}
          cssClasses={["notification-popup-summary"]}
        />
        <box hexpand />
        <button
          $={(self) => {
            self.connect("clicked", () => {
              notification.dismiss();
            });
          }}
          cssClasses={["notification-popup-close"]}
        >
          <label label="×" />
        </button>
      </box>

      {notification.body && (
        <label
          label={notification.body}
          halign={Gtk.Align.START}
          wrap
          cssClasses={["notification-popup-body"]}
        />
      )}

      {notification.appName && (
        <label
          label={notification.appName}
          halign={Gtk.Align.START}
          cssClasses={["notification-popup-app"]}
        />
      )}
    </box>
  );
}

export default function NotificationPopups() {
  const monitors = createBinding(app, "monitors");
  const notifd = Notifd.get_default();

  const [notifications, setNotifications] = createState(
    new Array<Notifd.Notification>(),
  );

  const notifiedHandler = notifd.connect("notified", (_, id, replaced) => {
    const notification = notifd.get_notification(id);
    if (replaced && notifications.get().some((n) => n.id === id)) {
      setNotifications((ns) => ns.map((n) => (n.id === id ? notification : n)));
    } else {
      setNotifications((ns) => [notification, ...ns]);
    }
  });

  const resolvedHandler = notifd.connect("resolved", (_, id) => {
    setNotifications((ns) => ns.filter((n) => n.id !== id));
  });

  onCleanup(() => {
    notifd.disconnect(notifiedHandler);
    notifd.disconnect(resolvedHandler);
  });

  return (
    <For each={monitors}>
      {(monitor) => (
        <window
          $={(self) => onCleanup(() => self.destroy())}
          cssClasses={["notification-popups"]}
          namespace="notification-popups"
          name={`notification-popups-${monitor.connector}`}
          gdkmonitor={monitor}
          visible={notifications((ns) => ns.length > 0)}
          exclusivity={Astal.Exclusivity.NORMAL}
          anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
          application={app}
        >
          <box orientation={Gtk.Orientation.VERTICAL}>
            <For each={notifications}>
              {(notification) => <Notification notification={notification} />}
            </For>
          </box>
        </window>
      )}
    </For>
  );
}
