import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Notifd from "gi://AstalNotifd";
import Pango from "gi://Pango"; // <--- Add this import
import { onCleanup, createState, For, createBinding } from "ags";
import app from "ags/gtk4/app";
import GLib from "gi://GLib";
import { notificationTimeout } from "./settings/Appearance";

function Notification({ notification }: { notification: Notifd.Notification }) {
  let timeoutId: number | null = null;

  const scheduleAutoDismiss = () => {
    if (timeoutId !== null) {
      GLib.source_remove(timeoutId);
    }
    timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      notificationTimeout.get(),
      () => {
        notification.dismiss();
        timeoutId = null;
        return false;
      },
    );
  };

  scheduleAutoDismiss();

  const unsubTimeout = notificationTimeout.subscribe(() => {
    scheduleAutoDismiss();
  });

  notification.connect("resolved", () => {
    unsubTimeout();
    if (timeoutId !== null) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
  });

  return (
    <box
      cssClasses={["notification-popup"]}
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={10}
      heightRequest={64}
      widthRequest={400}
    >
      {notification.image && (
        <box
          cssClasses={["notification-popup-image-wrapper"]}
          widthRequest={44}
          heightRequest={44}
          valign={Gtk.Align.CENTER}
          hexpand={false}
          $={(self) => {
            try {
              const GdkPixbuf = imports.gi.GdkPixbuf;
              const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
                notification.image,
                50,
                50,
                false,
              );
              const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
              const picture = new Gtk.Picture();
              picture.set_paintable(texture);
              picture.set_size_request(44, 44);
              self.append(picture);
            } catch (e) {
              console.error("Failed to load notification image:", e);
            }
          }}
        />
      )}

      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand>
        <box cssClasses={["notification-popup-header"]}>
          <label
            label={notification.summary}
            halign={Gtk.Align.START}
            cssClasses={["notification-popup-summary"]}
            hexpand
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={20}
          />
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
            useMarkup
            cssClasses={["notification-popup-body"]}
            ellipsize={Pango.EllipsizeMode.END}
            lines={2}
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
