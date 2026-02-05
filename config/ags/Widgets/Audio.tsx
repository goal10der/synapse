import AstalWp from "gi://AstalWp"
import { createBinding } from "ags"

export default function AudioOutput() {
  const { defaultSpeaker: speaker } = AstalWp.get_default()!

  return (
    <menubutton cssClasses={["audio-output"]}>
      <image iconName={createBinding(speaker, "volumeIcon")} />
      <popover>
        <box cssClasses={["audio-output"]}>
          <slider
            widthRequest={260}
            onChangeValue={({ value }) => speaker.set_volume(value)}
            value={createBinding(speaker, "volume")}
          />
        </box>
      </popover>
    </menubutton>
  )
}