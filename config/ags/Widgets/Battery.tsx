import Gtk from "gi://Gtk?version=4.0";
import AstalBattery from "gi://AstalBattery";
import AstalPowerProfiles from "gi://AstalPowerProfiles";
import { createBinding } from "ags";

export default function Battery() {
  const battery = AstalBattery.get_default();
  const powerprofiles = AstalPowerProfiles.get_default();

  const percent = createBinding(
    battery,
    "percentage",
  )((p) => `${Math.round(p * 100)}%`);

  const tooltip = createBinding(
    battery,
    "time-to-empty",
  )((s) => {
    if (battery.charging) {
      const fullSeconds = battery.time_to_full;
      if (fullSeconds <= 0) return "Charging (Calculating...)";
      const h = Math.floor(fullSeconds / 3600);
      const m = Math.floor((fullSeconds % 3600) / 60);
      return `Charging (${h}h ${m}m until full)`;
    }
    if (s <= 0 || s > 86400) return "Calculating remaining time...";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m remaining`;
  });

  const setProfile = (profile: string): void => {
    powerprofiles.set_active_profile(profile);
  };

  return (
    <menubutton
      visible={createBinding(battery, "isPresent")}
      cssClasses={["battery"]}
      tooltipText={tooltip}
      heightRequest={24}
      valign={Gtk.Align.CENTER}
    >
      <box valign={Gtk.Align.CENTER}>
        <image iconName={createBinding(battery, "iconName")} />
        <label label={percent} />
      </box>
      <popover>
        <box
          orientation={Gtk.Orientation.VERTICAL}
          cssClasses={["popover-box"]}
        >
          <label label="Power Profiles" cssClasses={["title"]} />
          {powerprofiles.get_profiles().map(({ profile }) => {
            const isActive = () => powerprofiles.active_profile === profile;

            return (
              <button
                onClicked={() => setProfile(profile)}
                cssClasses={
                  isActive()
                    ? ["power-profile-button", "active"]
                    : ["power-profile-button"]
                }
                $={(self: any) => {
                  const updateClasses = () => {
                    const classes = isActive()
                      ? ["power-profile-button", "active"]
                      : ["power-profile-button"];
                    self.set_css_classes(classes);
                  };
                  const handler = powerprofiles.connect(
                    "notify::active-profile",
                    updateClasses,
                  );
                  self.connect("destroy", () => {
                    powerprofiles.disconnect(handler);
                  });
                }}
              >
                <label label={profile} xalign={0} />
              </button>
            );
          })}
        </box>
      </popover>
    </menubutton>
  );
}
