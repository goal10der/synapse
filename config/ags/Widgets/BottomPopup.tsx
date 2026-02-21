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

  const coverArt = new Variable("");
  const title = new Variable("No media playing");
  const artist = new Variable("Unknown artist");
  const isPlaying = new Variable(false);

  // Track per-player signal connections so we can disconnect when the player changes.
  let playerSignals: number[] = [];
  let currentPlayer: Mpris.Player | null = null;

  const disconnectPlayer = () => {
    if (currentPlayer) {
      playerSignals.forEach((id) => {
        try {
          currentPlayer!.disconnect(id);
        } catch (_) {}
      });
      playerSignals = [];
      currentPlayer = null;
    }
  };

  const updatePlayer = () => {
    const player = mpris.get_players()[0] ?? null;

    if (!player) {
      disconnectPlayer();
      coverArt.set("");
      title.set("No media playing");
      artist.set("Unknown artist");
      isPlaying.set(false);
      return;
    }

    // Same player – no need to rewire signals.
    if (player === currentPlayer) return;

    disconnectPlayer();
    currentPlayer = player;

    const syncAll = () => {
      let cover = "";
      try {
        cover = player.coverArt || player.cover_art || "";
      } catch (_) {}
      coverArt.set(cover);
      title.set(player.title || "No media playing");
      artist.set(player.artist || "Unknown artist");
      isPlaying.set(player.playbackStatus === Mpris.PlaybackStatus.PLAYING);
    };

    syncAll();

    playerSignals.push(player.connect("notify::cover-art", syncAll));
    playerSignals.push(player.connect("notify::title", syncAll));
    playerSignals.push(player.connect("notify::artist", syncAll));
    playerSignals.push(player.connect("notify::playback-status", syncAll));
  };

  mpris.connect("notify::players", updatePlayer);
  updatePlayer();

  // ── Album cover (CSS background) ─────────────────────────────────────────

  const albumCoverBox = new Gtk.Box();
  albumCoverBox.set_css_classes(["album-cover"]);
  albumCoverBox.set_size_request(100, 100);
  albumCoverBox.set_hexpand(false);
  albumCoverBox.set_vexpand(false);
  albumCoverBox.set_halign(Gtk.Align.START);
  albumCoverBox.set_valign(Gtk.Align.CENTER);

  let coverArtProvider: Gtk.CssProvider | null = null;

  coverArt.subscribe((art) => {
    if (coverArtProvider) {
      albumCoverBox.get_style_context().remove_provider(coverArtProvider);
    }
    coverArtProvider = new Gtk.CssProvider();

    if (!art) {
      coverArtProvider.load_from_data(
        "* { border-radius: 8px; background-color: rgba(255,255,255,0.1); }",
        -1,
      );
    } else {
      const imageUrl = art.startsWith("file://")
        ? art
        : art.startsWith("/")
          ? `file://${art}`
          : art;
      coverArtProvider.load_from_data(
        `* { background-image: url('${imageUrl}'); background-size: cover;
             background-position: center; border-radius: 8px; }`,
        -1,
      );
    }
    albumCoverBox
      .get_style_context()
      .add_provider(coverArtProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
  });

  // ── Labels ────────────────────────────────────────────────────────────────

  const titleLabel = (
    <label
      cssClasses={["track-title"]}
      ellipsize={3}
      maxWidthChars={35}
      xalign={0}
      label={title.get()}
    />
  ) as any;
  title.subscribe((t) => {
    titleLabel.label = t;
  });

  const artistLabel = (
    <label
      cssClasses={["track-artist"]}
      ellipsize={3}
      maxWidthChars={35}
      xalign={0}
      label={artist.get()}
    />
  ) as any;
  artist.subscribe((a) => {
    artistLabel.label = a;
  });

  const playPauseLabel = (<label label={isPlaying.get() ? "󰏤" : "󰐊"} />) as any;
  isPlaying.subscribe((p) => {
    playPauseLabel.label = p ? "󰏤" : "󰐊";
  });

  // ── Window ────────────────────────────────────────────────────────────────

  const window = (
    <window
      visible={false}
      name={`music-popup-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      anchor={Astal.WindowAnchor.BOTTOM}
      exclusivity={Astal.Exclusivity.NORMAL}
      application={app}
      keymode={Astal.Keymode.ON_DEMAND}
      cssClasses={["music-popup-window"]}
      $={(self) => {
        // Fix: was always setting visible=false regardless of value.
        const unsub = isPlaying.subscribe((playing) => {
          // Keep window driven by whether there is an active player, not
          // play/pause state. Visibility is set by player presence above.
        });
        self.connect("destroy", () => {
          disconnectPlayer();
        });
      }}
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
              onClicked={() => mpris.get_players()[0]?.previous()}
            >
              <label label="󰒮" />
            </button>
            <button
              cssClasses={["control-button", "play-pause"]}
              onClicked={() => mpris.get_players()[0]?.play_pause()}
            >
              {playPauseLabel}
            </button>
            <button
              cssClasses={["control-button", "next"]}
              onClicked={() => mpris.get_players()[0]?.next()}
            >
              <label label="󰒭" />
            </button>
          </box>
        </box>
      </box>
    </window>
  ) as any;

  // Drive window visibility from player presence.
  const updateVisibility = () => {
    window.visible = mpris.get_players().length > 0;
  };

  return window;
}
