# Synapse Dottfiles
Pull requests and help would be great i am learning ts as i go with this project so if you notice anything within this please tell me


## Preview





https://github.com/user-attachments/assets/ca0ebaf2-4b67-4a52-af28-7114d5e20b2b






Wallpaper taken by me


## Install
WARNING INSTALL SCRIPT CURRENTLY OVERWRITES THE ~/.config/hypr/custom/ DIR IF YOU HAVE TO UPDATE BACK THESE UP (script also auto backups .config to your home dir with the date)
```bash
git clone https://github.com/goal10der/synapse
cd synapse
chmod +x ./install.sh
./install.sh
```
## ⌨️ Keybindings

The following keybindings are configured for **Synapse**. Most actions use the `Super` (Windows/Command) key.

### Application Shortcuts
| Shortcut | Action |
| :--- | :--- |
| `Super + Q` | Kill Active Window |
| 'Super + C' | Code Editor
| 'Super + W' | Browser
| 'Super + E' | File Manager
| 'Super + Enter'| Terminal

### Window Management
| Shortcut | Action |
| :--- | :--- |
| `Super + Alt + Space` | Toggle Floating Mode |
| `Super + Left Mouse` | Move Window |
| `Super + Right Mouse` | Resize Window |
| `Super + 1-5` | Switch to Workspace 1-5 |
| `Super + Alt + 1-5` | Move Window to Workspace 1-5 |

### Shell Keybindings
| Shortcut | Action |
| :--- | :--- |
| `Super` (Tap) | Toggle AGS Shell App Launcher |
| `Ctrl + Shift + Esc` | Open System Monitor (btop) |
| `Super + Ctrl + Shift + K` | **Exit Hyprland (Immediate Logout)** |
---

## User Setup

These are the default vars in hypr/variables.conf for the apps and keybinds change these in ~/.config/hypr/custom/variables.conf

```bash
# basic apps
$term = foot
$filemgr = thunar
$browser = zen-browser
$code = code

# Keybinds
$termkb = Super, Return
$filemgrkb = Super, E
$browserkb = Super, W
$codekb = Super, C
