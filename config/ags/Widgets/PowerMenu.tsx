import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GLib from "gi://GLib";

const PowerButton = ({
  label,
  icon,
  action,
  className,
}: {
  label: string;
  icon: string;
  action: () => void;
  className: string;
}) => (
  <button
    onClicked={action}
    cssClasses={["powermenu-card", className]}
    halign={Gtk.Align.CENTER}
    valign={Gtk.Align.CENTER}
  >
    <box orientation={Gtk.Orientation.VERTICAL} spacing={12}>
      <image iconName={icon} pixelSize={64} />
      <label label={label} />
    </box>
  </button>
);

export default function PowerMenu({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor;
  const state = { revealer: null as Gtk.Revealer | null };

  const hide = () => {
    if (state.revealer) {
      state.revealer.reveal_child = false;
      setTimeout(() => {
        const win = app.get_window(`powermenu-${gdkmonitor.connector}`);
        if (win) win.visible = false;
      }, 300);
    }
  };

  return (
    <window
      visible={false}
      name={`powermenu-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      namespace="powermenu"
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      layer={Astal.Layer.OVERLAY}
      application={app}
      $={(self) => {
        self.connect("notify::visible", () => {
          if (self.visible && state.revealer) {
            state.revealer.reveal_child = true;
          }
        });
      }}
    >
      <Gtk.EventControllerKey
        $={(self) =>
          self.connect("key-pressed", (_e, keyval) => {
            if (keyval === Gdk.KEY_Escape) hide();
          })
        }
      />

      {/* Background overlay */}
      <box
        cssClasses={["powermenu-fullscreen-bg"]}
        hexpand
        vexpand
        halign={Gtk.Align.FILL}
        valign={Gtk.Align.FILL}
        $={(self) => {
          const gesture = new Gtk.GestureClick();
          gesture.connect("pressed", (_g, _n, x, y) => {
            const pick = self.pick(x, y, Gtk.PickFlags.DEFAULT);
            if (
              !pick ||
              (!pick.get_css_classes().includes("powermenu-card") &&
                !pick.get_css_classes().includes("powermenu-container"))
            ) {
              hide();
            }
          });
          self.add_controller(gesture);
        }}
      >
        <revealer
          $={(self) => {
            state.revealer = self;
          }}
          transitionType={Gtk.RevealerTransitionType.CROSSFADE}
          transitionDuration={300}
          revealChild={false}
          hexpand
          vexpand
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        >
          <box
            spacing={32}
            cssClasses={["powermenu-container"]}
            orientation={Gtk.Orientation.HORIZONTAL}
          >
            <PowerButton
              label="Lock"
              icon="system-lock-screen-symbolic"
              className="lock"
              action={() => {
                hide();
                GLib.spawn_command_line_async("hyprlock");
              }}
            />
            <PowerButton
              label="Hibernate"
              icon="media-playback-pause-symbolic"
              className="hibernate"
              action={() => {
                hide();
                GLib.spawn_command_line_async("systemctl hibernate");
              }}
            />
            <PowerButton
              label="Reboot"
              icon="system-reboot-symbolic"
              className="reboot"
              action={() => {
                hide();
                GLib.spawn_command_line_async("systemctl reboot");
              }}
            />
            <PowerButton
              label="Shutdown"
              icon="system-shutdown-symbolic"
              className="shutdown"
              action={() => {
                hide();
                GLib.spawn_command_line_async("systemctl poweroff");
              }}
            />
          </box>
        </revealer>
      </box>
    </window>
  );
}
