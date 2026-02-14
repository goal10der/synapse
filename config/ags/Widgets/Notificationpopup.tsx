import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Notifd from "gi://AstalNotifd";
import Pango from "gi://Pango";
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

  // Create notification image box if image exists
  let notificationImageBox: Gtk.Box | null = null;

  if (notification.image) {
    notificationImageBox = new Gtk.Box();
    notificationImageBox.set_css_classes(["notification-popup-image-wrapper"]);
    notificationImageBox.set_size_request(70, 70);
    notificationImageBox.set_hexpand(false);
    notificationImageBox.set_vexpand(false);
    notificationImageBox.set_halign(Gtk.Align.CENTER);
    notificationImageBox.set_valign(Gtk.Align.CENTER);

    // Use CSS provider for the image (like WallpaperPicker and BottomPopup)
    const imageProvider = new Gtk.CssProvider();
    const imageUrl = notification.image.startsWith("file://")
      ? notification.image
      : notification.image.startsWith("/")
        ? `file://${notification.image}`
        : notification.image;

    imageProvider.load_from_data(
      `
      * {
        background-image: url('${imageUrl}');
        background-size: cover;
        background-position: center;
        border-radius: 4px;
      }
      `,
      -1,
    );

    notificationImageBox
      .get_style_context()
      .add_provider(imageProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  }

  return (
    <box
      cssClasses={["notification-popup"]}
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={10}
      heightRequest={64}
      widthRequest={400}
    >
      {notificationImageBox}

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
