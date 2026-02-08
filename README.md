# Synapse Dotfiles

A modern Hyprland configuration with dynamic Material You theming and a custom AGS shell.

> **Note:** This is a learning project built while exploring TypeScript. Contributions, suggestions, and pull requests are highly welcome!

## Preview

https://github.com/user-attachments/assets/ca0ebaf2-4b67-4a52-af28-7114d5e20b2b

_Wallpaper photographed by me_

## Features

- **Dynamic Material You Theming** - Automatic color palette generation from wallpapers using Matugen
- **Smart Wallpaper Management** - Live wallpaper switching with automatic color theme updates
- **Custom AGS Shell** - Reactive UI built with Aylur's GTK Shell
- **Modern Animations** - Smooth, physics-based window and workspace transitions
- **Network Management** - Integrated WiFi and Bluetooth controls
- **Power Profiles** - Quick switching between power modes for laptops
- **System Monitoring** - Built-in resource monitoring with btop integration
- **User Config Preservation** - Custom settings survive updates

## Installation

### Prerequisites

- Arch Linux or Arch-based distribution
- An AUR helper (yay or paru)
- Git

### Quick Install

```bash
git clone https://github.com/goal10der/synapse
cd synapse
chmod +x ./install.sh
./install.sh --aur-helper=yay  # or use paru
```

### Installation Options

The install script supports several flags:

```bash
./install.sh [OPTIONS]

Options:
  --aur-helper=[yay|paru]     Required: Specify which AUR helper to use
  --vscode=[vscode|code]      Optional: Install Visual Studio Code or Code-OSS
  --zen-browser               Optional: Install Zen Browser
  --noconfirm                 Optional: Skip all confirmation prompts
  -h, --help                  Show help message
```

**Examples:**

```bash
# Basic installation with yay
./install.sh --aur-helper=yay

# Install with VSCode and Zen Browser
./install.sh --aur-helper=paru --vscode=vscode --zen-browser

# Automated installation (use with caution)
./install.sh --aur-helper=yay --noconfirm
```

### What Gets Installed

**Core Packages:**

- Hyprland (Wayland compositor)
- AGS (Aylur's GTK Shell)
- Matugen (Material You color generation)
- awww (Wallpaper daemon)
- hyprlock/hypridle (Lock screen and idle daemon)
- foot (Terminal emulator)
- Various utilities (grim, slurp, wl-clipboard, etc.)

**Optional Packages:**

- Visual Studio Code or Code-OSS
- Zen Browser

### Post-Installation

After installation:

1. **Logout and back in** to start your Hyprland session
2. **Enable iwd service** if not already running:
   ```bash
   sudo systemctl enable --now iwd
   ```
3. **Add wallpapers** to `~/Wallpapers/` directory
4. **Customize** your settings in `~/.config/hypr/custom/`

## Configuration

### User-Specific Settings

Your personal configurations are stored in `~/.config/hypr/custom/` and will be preserved across updates.

**Key files:**

- `~/.config/hypr/custom/variables.conf` - Application bindings and keybinds
- `~/.config/hypr/custom/user.conf` - Additional Hyprland configuration

### Default Application Bindings

Located in `hypr/variables.conf` (override in `~/.config/hypr/custom/variables.conf`):

```bash
# Applications
$term = foot              # Terminal
$filemgr = thunar        # File manager
$browser = zen-browser   # Web browser
$code = code             # Code editor

# Keybinds
$termkb = Super, Return
$filemgrkb = Super, E
$browserkb = Super, W
$codekb = Super, C
```

### Customization Examples

**Change default terminal:**

```bash
# In ~/.config/hypr/custom/variables.conf
$term = alacritty
```

**Add custom keybind:**

```bash
# In ~/.config/hypr/custom/user.conf
bind = Super, T, exec, telegram-desktop
```

**Adjust mouse sensitivity:**

```bash
# In ~/.config/hypr/custom/variables.conf
$sensitivity = 0.5
```

## Keybindings

### Applications

| Keybind          | Action              |
| ---------------- | ------------------- |
| `Super + Return` | Open Terminal       |
| `Super + E`      | Open File Manager   |
| `Super + W`      | Open Browser        |
| `Super + C`      | Open Code Editor    |
| `Super + Q`      | Kill Active Window  |
| `Super` (tap)    | Toggle App Launcher |
| `Super + N`      | Toggle Sidebar      |

### Window Management

| Keybind               | Action                        |
| --------------------- | ----------------------------- |
| `Super + Alt + Space` | Toggle Floating Mode          |
| `Super + Left Click`  | Move Window                   |
| `Super + Right Click` | Resize Window                 |
| `Super + 1-0`         | Switch to Workspace 1-10      |
| `Super + Alt + 1-0`   | Move Window to Workspace 1-10 |

### Screenshots

| Keybind             | Action                           |
| ------------------- | -------------------------------- |
| `Super + Shift + S` | Screenshot (copies to clipboard) |

### System

| Keybind                    | Action                     |
| -------------------------- | -------------------------- |
| `Ctrl + Shift + Esc`       | Open System Monitor (btop) |
| `Super + Shift + R`        | Restart AGS Shell          |
| `Super + Ctrl + Shift + K` | Exit Hyprland (logout)     |

### Media Keys

| Keybind                 | Action              |
| ----------------------- | ------------------- |
| `XF86AudioRaiseVolume`  | Increase Volume     |
| `XF86AudioLowerVolume`  | Decrease Volume     |
| `XF86AudioMute`         | Toggle Mute         |
| `XF86MonBrightnessUp`   | Increase Brightness |
| `XF86MonBrightnessDown` | Decrease Brightness |

## Wallpapers

### Adding Wallpapers

1. Place images in `~/Wallpapers/`
2. Open the settings button located on the bar
3. Navigate to the wallpaper section
4. Click on any wallpaper to apply

The wallpaper picker automatically detects new images added to the directory.

### Supported Formats

- JPG/JPEG
- PNG
- GIF

### Color Theme Generation

When you select a wallpaper, Matugen automatically:

1. Extracts dominant colors
2. Generates a Material You color palette
3. Updates all UI elements to match

You can change the color generation scheme in the settings panel.

## Updating

To update your configuration:

```bash
cd synapse
git pull
./install.sh --aur-helper=yay  # Your custom configs will be preserved
```

**Note:** Your `~/.config/hypr/custom/` directory is automatically preserved during updates.

## Troubleshooting

### Network Icon Not Working

Ensure iwd is running:

```bash
sudo systemctl enable --now iwd
systemctl status iwd
```

### AGS Shell Not Loading

Restart the shell:

```bash
Super + Shift + R
```

Or restart manually:

```bash
pkill ags && pkill gjs
~/.config/ags/app.tsx
```

### Wallpaper Not Changing

1. Check that awww daemon is running:

   ```bash
   pgrep -a awww
   ```

2. Manually restart:
   ```bash
   pkill awww
   awww-daemon --format xrgb &
   ```

### Colors Not Updating

Manually regenerate colors:

```bash
matugen image -t scheme-tonal-spot ~/Wallpapers/your-wallpaper.jpg
```

## File Structure

```
~/.config/
├── ags/                    # AGS shell configuration
├── hypr/                   # Hyprland configuration
│   ├── custom/            # User configs (preserved on update)
│   │   ├── variables.conf # Your app/keybind overrides
│   │   └── user.conf      # Your additional configs
│   ├── hyprland/          # Core Hyprland configs
│   ├── colors/            # Generated color schemes
│   └── scripts/           # Helper scripts
├── foot/                   # Terminal config
├── btop/                   # System monitor config
└── matugen/               # Theme generator config
```

## Dependencies

**Required:**

- hyprland
- aylurs-gtk-shell-git
- libastal-meta
- matugen
- awww-bin
- foot
- iwd
- polkit-gnome
- hyprlock
- hypridle
- grim, slurp, wl-clipboard
- brightnessctl

**Optional:**

- zen-browser
- visual-studio-code-bin or code
- thunar
- blueman

## Contributing

This project is a learning experience, and contributions are greatly appreciated!

**Ways to contribute:**

- Report bugs or issues
- Suggest features or improvements
- Submit pull requests
- Share your customizations
- Improve documentation

**For code contributions:**

- This project uses TypeScript for AGS components
- Follow existing code style
- Test changes before submitting
- Provide clear commit messages

## Credits

- **Hyprland** - Vaxry and contributors
- **AGS** - Aylur
- **Matugen** - InioX
- **awww** - zjeffer

## License

This project is open source. Feel free to use and modify as needed.

---

**Repository:** https://github.com/goal10der/synapse

**Issues/Suggestions:** https://github.com/goal10der/synapse/issues
