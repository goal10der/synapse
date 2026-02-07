#!/usr/bin/env bash

handle() {
  case $1 in
    monitoradded*)
      # Wait for the new monitor to initialize in the workspace tree
      sleep 1
      
      # 1. Grab the current wallpaper path from awww query
      # This uses the same logic we used for Matugen
      CURRENT_WALL="$(awww query | sed -n 's/.*image: //p' | cut -d: -f1 | head -n1 | xargs)"

      # 2. If a path was found, apply it to all monitors (including the new one)
      if [ -n "$CURRENT_WALL" ] && [ -f "$CURRENT_WALL" ]; then
          echo "New monitor detected. Applying: $CURRENT_WALL"
          awww img "$CURRENT_WALL"
      else
          echo "Could not detect a current wallpaper to apply."
      fi
      ;;
  esac
}

# Listen to Hyprland's event socket
socat -U - "UNIX-CONNECT:$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock" | while read -r line; do
  handle "$line"
done