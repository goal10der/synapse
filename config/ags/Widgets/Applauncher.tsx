import { For, createState, onCleanup } from "ags";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import AstalApps from "gi://AstalApps";

const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;

export default function Applauncher() {
  let searchentry: Gtk.Entry;
  let win: Astal.Window;
  const apps = new AstalApps.Apps();
  const [list, setList] = createState<AstalApps.Application[]>([]);
  try {
    const appsSignalId = apps.connect("notify::list", () => {
      apps.reload();
      if (searchentry && searchentry.text !== "") {
        search(searchentry.text);
      }
    });
    onCleanup(() => {
      if (appsSignalId && typeof apps.disconnect === "function") {
        try {
          apps.disconnect(appsSignalId);
        } catch (e) {
          console.error("Failed to disconnect apps signal:", e);
        }
      }
    });
  } catch (e) {
    console.error("Failed to connect apps signal:", e);
  }

  function search(text: string): void {
    if (text === "") {
      setList([]);
    } else {
      setList(apps.fuzzy_query(text).slice(0, 8));
    }
  }

  function launch(app?: AstalApps.Application): void {
    if (app) {
      try {
        win.set_visible(false);
        app.launch();
      } catch (e) {
        console.error("Failed to launch application:", e);
        // Show window again if launch failed
        win.set_visible(true);
      }
    }
  }

  return (
    <window
      $={(self: any) => {
        win = self;
        try {
          const visibleSignalId = self.connect("notify::visible", () => {
            try {
              if (self.visible) {
                apps.reload();
                if (searchentry) {
                  searchentry.grab_focus();
                }
              } else {
                if (searchentry) {
                  searchentry.set_text("");
                }
              }
            } catch (e) {
              console.error("Error in launcher visibility handler:", e);
            }
          });
          self.connect("destroy", () => {
            try {
              self.disconnect(visibleSignalId);
            } catch (e) {
              console.error("Failed to disconnect visible signal:", e);
            }
          });
        } catch (e) {
          console.error("Failed to setup launcher window:", e);
        }
      }}
      name="launcher"
      visible={false}
      anchor={TOP | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.EXCLUSIVE}
    >
      <Gtk.EventControllerKey
        $={(self) =>
          self.connect("key-pressed", (_e, keyval) => {
            if (keyval === Gdk.KEY_Escape) win.visible = false;
          })
        }
      />
      <Gtk.Box
        name="launcher-content"
        valign={Gtk.Align.START}
        halign={Gtk.Align.CENTER}
        orientation={Gtk.Orientation.VERTICAL}
      >
        <Gtk.Entry
          name="search-entry"
          $={(ref: any) => {
            searchentry = ref;
            try {
              const changedSignalId = ref.connect("changed", () => {
                try {
                  search(ref.text);
                } catch (e) {
                  console.error("Failed to search:", e);
                }
              });
              const activateSignalId = ref.connect("activate", () => {
                try {
                  const firstApp = list()[0];
                  if (firstApp) launch(firstApp);
                } catch (e) {
                  console.error("Failed to launch app:", e);
                }
              });
              ref.connect("destroy", () => {
                try {
                  ref.disconnect(changedSignalId);
                  ref.disconnect(activateSignalId);
                } catch (e) {
                  console.error("Failed to disconnect entry signals:", e);
                }
              });
            } catch (e) {
              console.error("Failed to setup launcher entry:", e);
            }
          }}
          placeholderText="Start typing to search..."
        />
        <Gtk.Revealer
          revealChild={list((l: any[]) => l.length > 0)}
          transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        >
          <Gtk.Box
            orientation={Gtk.Orientation.VERTICAL}
            name="results-container"
          >
            <Gtk.Separator />
            <Gtk.Box orientation={Gtk.Orientation.VERTICAL}>
              <For each={list}>
                {(app) => (
                  <Gtk.Button
                    name="app-item"
                    $={(self) => {
                      try {
                        const clickId = self.connect("clicked", () => {
                          try {
                            launch(app);
                          } catch (e) {
                            console.error("Failed to launch app:", e);
                          }
                        });
                      } catch (e) {
                        console.error("Failed to connect button click:", e);
                      }
                    }}
                  >
                    <Gtk.Box name="app-item-content">
                      <Gtk.Image
                        iconName={app.iconName || "system-run-symbolic"}
                      />
                      <Gtk.Label label={app.name} maxWidthChars={40} wrap />
                    </Gtk.Box>
                  </Gtk.Button>
                )}
              </For>
            </Gtk.Box>
          </Gtk.Box>
        </Gtk.Revealer>
      </Gtk.Box>
    </window>
  );
}
