import { For, createState } from "ags";
import Astal from "gi://Astal?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import AstalApps from "gi://AstalApps";

const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;

export default function Applauncher() {
  let searchentry: Gtk.Entry;
  let win: Astal.Window;
  const apps = new AstalApps.Apps();

  // State for search results
  const [list, setList] = createState<AstalApps.Application[]>([]);

  // Listen for app changes (installed/removed)
  apps.connect("notify::list", () => {
    // Reload apps when the list changes
    apps.reload();
    // Re-run search with current query if there is one
    if (searchentry && searchentry.text !== "") {
      search(searchentry.text);
    }
  });

  function search(text: string) {
    if (text === "") {
      setList([]);
    } else {
      // fuzzy_query returns the list
      setList(apps.fuzzy_query(text).slice(0, 8));
    }
  }

  function launch(app?: AstalApps.Application) {
    if (app) {
      win.set_visible(false);
      app.launch();
    }
  }

  return (
    <window
      $={(self: any) => {
        win = self;
        self.connect("notify::visible", () => {
          if (self.visible) {
            // Reload apps when opening launcher to catch any changes
            apps.reload();
            searchentry.grab_focus();
          } else {
            searchentry.set_text("");
          }
        });
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
            ref.connect("changed", () => search(ref.text));
            ref.connect("activate", () => launch(list()[0]));
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
                    $={(self) => self.connect("clicked", () => launch(app))}
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
