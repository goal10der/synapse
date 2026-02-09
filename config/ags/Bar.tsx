import app from "ags/gtk4/app";
import Astal from "gi://Astal?version=4.0";
import Gdk from "gi://Gdk?version=4.0";
import Gtk from "gi://Gtk?version=4.0";
import GObject from "gi://GObject";
import { onCleanup } from "ags";
import Workspaces from "./Widgets/Workspaces";
import Clock from "./Widgets/Clock";
import Tray from "./Widgets/Tray";
import Battery from "./Widgets/Battery";
import { barConfig, editMode, saveBarConfig, type WidgetType } from "./State";

type Section = "left" | "center" | "right";

export default function Bar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  let leftBox: Gtk.Box;
  let centerBox: Gtk.Box;
  let rightBox: Gtk.Box;
  let draggedWidget: WidgetType | null = null;

  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor;
  const draggableContainers = new Map<WidgetType, Gtk.Box>();
  const createWidget = (type: WidgetType): Gtk.Widget => {
    switch (type) {
      case "clock":
        return (<Clock gdkmonitor={gdkmonitor} />) as Gtk.Widget;
      case "settings":
        return (
          <button
            onClicked={() =>
              app.toggle_window(`settings-window-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button"]}
            valign={Gtk.Align.CENTER}
            heightRequest={24}
          >
            <image
              iconName="emblem-system-symbolic"
              pixelSize={14}
              cssClasses={["bar-button-image"]}
            />
          </button>
        ) as Gtk.Widget;
      case "workspaces":
        return (<Workspaces />) as Gtk.Widget;
      case "tray":
        return (<Tray />) as Gtk.Widget;
      case "sidebar":
        return (
          <button
            onClicked={() =>
              app.toggle_window(`RightSidebar-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button", "sidebar-toggle"]}
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            heightRequest={24}
            widthRequest={24}
          >
            <image
              iconName="open-menu-symbolic"
              pixelSize={14}
              cssClasses={["bar-button-image"]}
            />
          </button>
        ) as Gtk.Widget;
      case "notifications":
        return (
          <button
            onClicked={() =>
              app.toggle_window(`notification-center-${gdkmonitor.connector}`)
            }
            cssClasses={["bar-button", "notification-button"]}
            valign={Gtk.Align.CENTER}
            heightRequest={24}
          >
            <image
              iconName="preferences-system-notifications-symbolic"
              pixelSize={14}
            />
          </button>
        ) as Gtk.Widget;
      case "battery":
        return (<Battery />) as Gtk.Widget;
      default:
        return (<box />) as Gtk.Widget;
    }
  };

  const createDragIcon = (type: WidgetType): Gtk.Widget => {
    const dragBox = new Gtk.Box();
    dragBox.add_css_class("drag-icon");
    const label = new Gtk.Label({ label: type });
    label.add_css_class("drag-label");
    dragBox.append(label);
    return dragBox;
  };

  const createDraggableContainer = (type: WidgetType): Gtk.Box => {
    const container = new Gtk.Box();
    container.add_css_class("draggable-widget");
    const widget = createWidget(type);
    container.append(widget);
    let dragOverState: "before" | "after" | null = null;

    const updateDragOverClass = () => {
      container.remove_css_class("drop-before");
      container.remove_css_class("drop-after");
      if (dragOverState === "before") container.add_css_class("drop-before");
      else if (dragOverState === "after") container.add_css_class("drop-after");
    };

    const updateEditMode = () => {
      const isEditMode = editMode.get();
      const controllers: Gtk.EventController[] = [];

      // Collect all existing drag/drop controllers
      let i = 0;
      let controller = container.observe_controllers().get_item(i);
      while (controller !== null) {
        if (
          controller instanceof Gtk.DragSource ||
          controller instanceof Gtk.DropTarget
        ) {
          controllers.push(controller);
        }
        i++;
        controller = container.observe_controllers().get_item(i);
      }

      controllers.forEach((c) => container.remove_controller(c));
      if (isEditMode) {
        container.add_css_class("edit-mode");
        const dragSource = Gtk.DragSource.new();
        dragSource.set_actions(Gdk.DragAction.MOVE);
        dragSource.connect("prepare", () => {
          const value = new GObject.Value();
          value.init(GObject.TYPE_STRING);
          value.set_string(type);
          return Gdk.ContentProvider.new_for_value(value);
        });
        dragSource.connect("drag-begin", (_source, drag) => {
          draggedWidget = type;
          const dragIcon = createDragIcon(type);
          const paintable = new Gtk.WidgetPaintable({ widget: dragIcon });
          dragSource.set_icon(paintable, 0, 0);
          container.add_css_class("dragging");
        });
        dragSource.connect("drag-end", () => {
          container.remove_css_class("dragging");
          draggedWidget = null;
        });
        container.add_controller(dragSource);

        const dropTarget = Gtk.DropTarget.new(
          GObject.TYPE_STRING,
          Gdk.DragAction.MOVE,
        );
        dropTarget.connect("motion", (_self, x, _y) => {
          const width = container.get_allocated_width();
          dragOverState = x < width / 2 ? "before" : "after";
          updateDragOverClass();
          return Gdk.DragAction.MOVE;
        });
        dropTarget.connect("leave", () => {
          dragOverState = null;
          updateDragOverClass();
        });
        dropTarget.connect("drop", (_self, _value, x, _y) => {
          if (!draggedWidget || draggedWidget === type) {
            dragOverState = null;
            updateDragOverClass();
            return false;
          }
          const width = container.get_allocated_width();
          const position = x < width / 2 ? "before" : "after";
          const currentConfig = barConfig.get();
          const newConfig = {
            left: [...currentConfig.left],
            center: [...currentConfig.center],
            right: [...currentConfig.right],
          };
          for (const section of ["left", "center", "right"] as const) {
            const index = newConfig[section].indexOf(draggedWidget);
            if (index !== -1) {
              newConfig[section].splice(index, 1);
              break;
            }
          }
          for (const section of ["left", "center", "right"] as const) {
            const targetIndex = newConfig[section].indexOf(type);
            if (targetIndex !== -1) {
              const insertIndex =
                position === "before" ? targetIndex : targetIndex + 1;
              newConfig[section].splice(insertIndex, 0, draggedWidget);
              break;
            }
          }
          saveBarConfig(newConfig);
          draggedWidget = null;
          dragOverState = null;
          updateDragOverClass();
          return true;
        });
        container.add_controller(dropTarget);
      } else {
        container.remove_css_class("edit-mode");
      }
    };

    const unsub = editMode.subscribe(updateEditMode);
    container.connect("destroy", unsub);
    updateEditMode();
    return container;
  };

  const createDropZone = (section: Section): Gtk.Box => {
    const dropZone = new Gtk.Box();
    dropZone.add_css_class("drop-zone");
    dropZone.set_hexpand(true);
    dropZone.set_size_request(40, 24);
    const label = new Gtk.Label({ label: `Drop here (${section})` });
    label.add_css_class("drop-zone-label");
    dropZone.append(label);
    let isOver = false;

    const updateDropZone = () => {
      if (isOver) dropZone.add_css_class("drop-zone-active");
      else dropZone.remove_css_class("drop-zone-active");
    };

    const updateEditMode = () => {
      const isEditMode = editMode.get();
      const controllers: Gtk.EventController[] = [];

      let i = 0;
      let controller = dropZone.observe_controllers().get_item(i);
      while (controller !== null) {
        if (controller instanceof Gtk.DropTarget) {
          controllers.push(controller);
        }
        i++;
        controller = dropZone.observe_controllers().get_item(i);
      }

      controllers.forEach((c) => dropZone.remove_controller(c));
      if (isEditMode) {
        const dropTarget = Gtk.DropTarget.new(
          GObject.TYPE_STRING,
          Gdk.DragAction.MOVE,
        );
        dropTarget.connect("enter", () => {
          isOver = true;
          updateDropZone();
          return Gdk.DragAction.MOVE;
        });
        dropTarget.connect("leave", () => {
          isOver = false;
          updateDropZone();
        });
        dropTarget.connect("drop", () => {
          if (!draggedWidget) {
            isOver = false;
            updateDropZone();
            return false;
          }
          const currentConfig = barConfig.get();
          const newConfig = {
            left: [...currentConfig.left],
            center: [...currentConfig.center],
            right: [...currentConfig.right],
          };
          for (const sec of ["left", "center", "right"] as const) {
            const index = newConfig[sec].indexOf(draggedWidget);
            if (index !== -1) {
              newConfig[sec].splice(index, 1);
              break;
            }
          }
          newConfig[section].push(draggedWidget);
          saveBarConfig(newConfig);
          draggedWidget = null;
          isOver = false;
          updateDropZone();
          return true;
        });
        dropZone.add_controller(dropTarget);
      }
    };

    const unsub = editMode.subscribe(updateEditMode);
    dropZone.connect("destroy", unsub);
    updateEditMode();
    return dropZone;
  };

  const getOrCreateContainer = (type: WidgetType): Gtk.Box => {
    if (!draggableContainers.has(type)) {
      draggableContainers.set(type, createDraggableContainer(type));
    }
    return draggableContainers.get(type)!;
  };

  const updateBar = () => {
    if (!leftBox || !centerBox || !rightBox) return;

    const config = barConfig.get();
    const isEditMode = editMode.get();

    [leftBox, centerBox, rightBox].forEach((box) => {
      let child = box.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
      }
    });

    const populate = (box: Gtk.Box, items: WidgetType[], section: Section) => {
      if (items.length === 0 && isEditMode) {
        box.append(createDropZone(section));
      } else {
        items.forEach((type) => {
          const container = getOrCreateContainer(type);
          if (container.get_parent()) container.get_parent()?.remove(container);
          box.append(container);
        });
      }
    };

    populate(leftBox, config.left, "left");
    populate(centerBox, config.center, "center");
    populate(rightBox, config.right, "right");
  };
  const unsub1 = barConfig.subscribe(updateBar);
  const unsub2 = editMode.subscribe(updateBar);

  onCleanup(() => {
    unsub1();
    unsub2();
  });

  return (
    <window
      $={(self) => {
        const updateWindowMode = (isEdit: boolean) => {
          if (isEdit) {
            self.add_css_class("bar-edit-mode");
          } else {
            self.remove_css_class("bar-edit-mode");
          }
        };
        updateWindowMode(editMode.get());
        const unsub = editMode.subscribe(updateWindowMode);
        self.connect("destroy", unsub);
      }}
      visible
      namespace="bar"
      name={`bar-${gdkmonitor.connector}`}
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      cssClasses={["bar"]}
    >
      <centerbox heightRequest={24} valign={Gtk.Align.CENTER}>
        <box
          $type="start"
          $={(self) => {
            leftBox = self;
            updateBar();
          }}
          valign={Gtk.Align.CENTER}
          spacing={4}
        />
        <box
          $type="center"
          $={(self) => {
            centerBox = self;
            updateBar();
          }}
          valign={Gtk.Align.CENTER}
        />
        <box
          $type="end"
          $={(self) => {
            rightBox = self;
            updateBar();
          }}
          spacing={8}
          valign={Gtk.Align.CENTER}
        />
      </centerbox>
    </window>
  );
}
