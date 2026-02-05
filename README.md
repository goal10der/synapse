# Synapse Dottfiles
## Preview


https://github.com/user-attachments/assets/25e1b1cc-f7d2-4dd1-9ce8-659e65d7a48d

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
| `Super` (Tap) | Toggle AGS Shell App Launcher |
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

### 🛠️ System & Hardware
| Shortcut | Action |
| :--- | :--- |
| `Ctrl + Shift + Esc` | Open System Monitor (btop) |
| `Super + Ctrl + Shift + K` | **Exit Hyprland (Immediate Logout)** |
---

## ⚙️ Configuration Setup

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
