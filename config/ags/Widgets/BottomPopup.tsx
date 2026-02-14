import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import Mpris from "gi://AstalMpris";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import { Variable } from "../utils/Variable";

export default function MusicPopup({
  gdkmonitor,
}: {
  gdkmonitor: Gdk.Monitor;
}) {
  const mpris = Mpris.get_default();

  // Create variables to track player state
  const isVisible = new Variable(false);
  const coverArt = new Variable("");
  const title = new Variable("No media playing");
  const artist = new Variable("Unknown artist");
  const isPlaying = new Variable(false);

  // Update variables when players change
  const updatePlayer = () => {
    const players = mpris.get_players();
    const player = players[0];

    if (!player) {
      isVisible.set(false);
      coverArt.set("");
      title.set("No media playing");
      artist.set("Unknown artist");
      isPlaying.set(false);
      return;
    }

    isVisible.set(true);

    // Access cover art property
    let cover = "";
    try {
      // Direct property access (this is working based on logs)
      cover = player.coverArt || player.cover_art || "";
      console.log("Cover art URL:", cover);
    } catch (e) {
      console.error("Error getting cover art:", e);
    }

    coverArt.set(cover);
    title.set(player.title || "No media playing");
    artist.set(player.artist || "Unknown artist");
    isPlaying.set(player.playbackStatus === Mpris.PlaybackStatus.PLAYING);

    // Listen to property changes on the current player
    player.connect("notify::cover-art", () => {
      let newCover = "";
      try {
        newCover = player.coverArt || player.cover_art || "";
        console.log("Cover art changed to:", newCover);
      } catch (e) {
        console.error("Error getting updated cover art:", e);
      }
      coverArt.set(newCover);
    });

    player.connect("notify::title", () => {
      title.set(player.title || "No media playing");
    });

    player.connect("notify::artist", () => {
      artist.set(player.artist || "Unknown artist");
    });

    player.connect("notify::playback-status", () => {
      isPlaying.set(player.playbackStatus === Mpris.PlaybackStatus.PLAYING);
    });
  };

  // Listen for player changes
  mpris.connect("notify::players", updatePlayer);

  // Initial update - but only if there are players
  if (mpris.get_players().length > 0) {
    updatePlayer();
  }

  // Create album cover box using CSS provider (like WallpaperPicker)
  const albumCoverBox = new Gtk.Box();
  albumCoverBox.set_css_classes(["album-cover"]);
  // Set size request to make it square
  albumCoverBox.set_size_request(100, 100);
  // Prevent the box from expanding
  albumCoverBox.set_hexpand(false);
  albumCoverBox.set_vexpand(false);
  albumCoverBox.set_halign(Gtk.Align.START);
  albumCoverBox.set_valign(Gtk.Align.CENTER);

  // Create CSS provider for the cover art
  let coverArtProvider: Gtk.CssProvider | null = null;

  // Subscribe to coverArt changes with CSS provider
  coverArt.subscribe((art) => {
    // Remove old provider if exists
    if (coverArtProvider) {
      albumCoverBox.get_style_context().remove_provider(coverArtProvider);
      coverArtProvider = null;
    }

    // Create new provider with updated cover art
    coverArtProvider = new Gtk.CssProvider();

    if (!art || art === "") {
      // No cover art - show placeholder
      coverArtProvider.load_from_data(
        `
        * {
          border-radius: 8px;
          background-color: rgba(255, 255, 255, 0.1);
        }
        `,
        -1,
      );
    } else {
      // Has cover art - ensure proper file:// protocol
      const imageUrl = art.startsWith("file://")
        ? art
        : art.startsWith("/")
          ? `file://${art}`
          : art;

      console.log("Setting cover art with URL:", imageUrl);

      coverArtProvider.load_from_data(
        `
        * {
          background-image: url('${imageUrl}');
          background-size: cover;
          background-position: center;
          border-radius: 8px;
        }
        `,
        -1,
      );
    }

    albumCoverBox
      .get_style_context()
      .add_provider(coverArtProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  });

  // Create title label
  const titleLabel = (
    <label
      cssClasses={["track-title"]}
      ellipsize={3}
      maxWidthChars={35}
      xalign={0}
      label={title.get()}
    />
  ) as any;

  // Subscribe to title changes
  title.subscribe((t) => {
    titleLabel.label = t;
  });

  // Create artist label
  const artistLabel = (
    <label
      cssClasses={["track-artist"]}
      ellipsize={3}
      maxWidthChars={35}
      xalign={0}
      label={artist.get()}
    />
  ) as any;

  // Subscribe to artist changes
  artist.subscribe((a) => {
    artistLabel.label = a;
  });

  // Create play/pause label
  const playPauseLabel = (<label label={isPlaying.get() ? "󰏤" : "󰐊"} />) as any;

  // Subscribe to isPlaying changes
  isPlaying.subscribe((playing) => {
    playPauseLabel.label = playing ? "󰏤" : "󰐊";
  });

  // Create the window
  const window = (
    <window
      visible={isVisible.get()}
      name={`music-popup-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      anchor={Astal.WindowAnchor.BOTTOM}
      exclusivity={Astal.Exclusivity.NORMAL}
      application={app}
      keymode={Astal.Keymode.ON_DEMAND}
      cssClasses={["music-popup-window"]}
    >
      <box cssClasses={["music-popup-content"]} spacing={16}>
        {albumCoverBox}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={8} vexpand>
          <box
            cssClasses={["track-info"]}
            orientation={Gtk.Orientation.VERTICAL}
            spacing={4}
          >
            {titleLabel}
            {artistLabel}
          </box>
          <box cssClasses={["controls"]} spacing={8}>
            <button
              cssClasses={["control-button", "previous"]}
              onClicked={() => {
                const player = mpris.get_players()[0];
                if (player) player.previous();
              }}
            >
              <label label="󰒮" />
            </button>
            <button
              cssClasses={["control-button", "play-pause"]}
              onClicked={() => {
                const player = mpris.get_players()[0];
                if (player) player.play_pause();
              }}
            >
              {playPauseLabel}
            </button>
            <button
              cssClasses={["control-button", "next"]}
              onClicked={() => {
                const player = mpris.get_players()[0];
                if (player) player.next();
              }}
            >
              <label label="󰒭" />
            </button>
          </box>
        </box>
      </box>
    </window>
  ) as any;

  // Subscribe to visibility changes
  isVisible.subscribe((visible) => {
    window.visible = false;
  });

  return window;
}
