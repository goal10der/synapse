import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Notifd from "gi://AstalNotifd";
import Pango from "gi://Pango";
import { onCleanup, createState, For, createBinding } from "ags";
import app from "ags/gtk4/app";
import GLib from "gi://GLib";
import { notificationTimeout } from "./settings/Appearance";

const escapeMarkup = (str: string) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function Notification({
  notification,
  onClose,
}: {
  notification: Notifd.Notification;
  onClose: () => void;
}) {
  let timeoutId: number | null = null;

  const clearTimeout = () => {
    if (timeoutId !== null) {
      GLib.source_remove(timeoutId);
      timeoutId = null;
    }
  };

  const scheduleAutoHide = () => {
    clearTimeout();
    timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      notificationTimeout.get(),
      () => {
        onClose();
        timeoutId = null;
        return false;
      },
    );
  };

  scheduleAutoHide();
  const unsub = notificationTimeout.subscribe(scheduleAutoHide);

  notification.connect("resolved", () => {
    unsub();
    clearTimeout();
  });

  const box = new Gtk.Box({
    css_classes: ["notification-popup"],
    spacing: 10,
    width_request: 400,
    height_request: 90,
  });

  if (notification.image) {
    const img = new Gtk.Box({
      css_classes: ["notification-popup-image-wrapper"],
    });
    img.set_size_request(60, 60);
    img.set_valign(Gtk.Align.CENTER);
    const provider = new Gtk.CssProvider();
    const url = notification.image.startsWith("/")
      ? `file://${notification.image}`
      : notification.image;
    provider.load_from_data(
      `* { background-image: url('${url}'); background-size: cover; border-radius: 4px; }`,
      -1,
    );
    img
      .get_style_context()
      .add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    box.append(img);
  }

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    hexpand: true,
    valign: Gtk.Align.CENTER,
    css_classes: ["notification-content-box"],
  });

  const header = new Gtk.Box({ spacing: 6 });
  header.append(
    new Gtk.Label({
      label: notification.summary,
      hexpand: true,
      halign: Gtk.Align.START,
      css_classes: ["notification-popup-summary"],
      ellipsize: Pango.EllipsizeMode.END,
      max_width_chars: 25,
    }),
  );

  const closeBtn = new Gtk.Button({
    css_classes: ["notification-popup-close"],
    valign: Gtk.Align.START,
  });
  closeBtn.set_child(new Gtk.Label({ label: "×" }));
  closeBtn.connect("clicked", () => {
    // Clean up subscription and timer before dismissing
    unsub();
    clearTimeout();
    notification.dismiss();
  });
  header.append(closeBtn);
  content.append(header);

  if (notification.body) {
    const body = new Gtk.Label({
      label: escapeMarkup(notification.body),
      wrap: true,
      use_markup: true,
      halign: Gtk.Align.START,
      css_classes: ["notification-popup-body"],
      lines: 2,
      ellipsize: Pango.EllipsizeMode.END,
      max_width_chars: 40,
    });
    content.append(body);
  }

  box.append(content);
  return box;
}

export default function NotificationPopups() {
  const monitors = createBinding(app, "monitors");
  const notifd = Notifd.get_default();
  const [notifications, setNotifications] = createState(
    new Array<Notifd.Notification>(),
  );

  const id1 = notifd.connect("notified", (_, id) => {
    const n = notifd.get_notification(id);
    n.ignoreTimeout = true;
    setNotifications((ns) => [n, ...ns.filter((i) => i.id !== id)]);
  });

  const id2 = notifd.connect("resolved", (_, id) => {
    setNotifications((ns) => ns.filter((n) => n.id !== id));
  });

  onCleanup(() => {
    notifd.disconnect(id1);
    notifd.disconnect(id2);
  });

  return (
    <For each={monitors}>
      {(monitor) => (
        <window
          namespace="notification-popups"
          gdkmonitor={monitor}
          visible={notifications((ns) => ns.length > 0)}
          anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
          application={app}
          layer={Astal.Layer.OVERLAY}
        >
          <box
            orientation={Gtk.Orientation.VERTICAL}
            spacing={10}
            cssClasses={["popups-container"]}
          >
            <For each={notifications}>
              {(n) => (
                <Notification
                  notification={n}
                  onClose={() =>
                    setNotifications((ns) => ns.filter((i) => i.id !== n.id))
                  }
                />
              )}
            </For>
          </box>
        </window>
      )}
    </For>
  );
}
