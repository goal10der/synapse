#!/usr/bin/env bash
sudo_prime() {
    echo "Sudo access is required to proceed with the installation."
    if ! sudo -v; then
        echo -e "\n\033[1;31m[!] Sudo authentication failed. Exiting...\033[0m"
        exit 1
    fi
    while true; do 
        sudo -n true
        sleep 60
        kill -0 "$$" || exit
    done 2>/dev/null &
    
    SUDO_PID=$! 
    echo -e "\033[0;32m[✓] Sudo access granted.\033[0m"
}
show_help() {
    echo "usage: ./install.sh [-h] [--aur-helper]"
    echo ""
    echo "options:"
    echo "  -h, --help                  show this help message and exit"
    echo "  --aur-helper=[yay|paru]     the AUR helper to use"
    echo "  --vscode=[vscode|code]      install code-oss or visual-studio-code (default: none)"
    echo "  --noconfirm                 ONLY use this flag if you want to skip all confirmation prompts"
    echo "  --zen-browser               install zen-browser"
}
getargs() {
    for arg in "$@"; do
        case $arg in
            -h|--help)
                show_help
                exit 0
                ;;
            --aur-helper=*)
                AUR_HELPER="${arg#*=}"
                ;;
            --vscode=*)
                VSCODE_OPTION="${arg#*=}"
                ;;
            --noconfirm)
                CONFIRM_FLAG="--noconfirm"
                ;;
            --zen-browser)
                ZEN_BROWSER_OPTION="yes"
                ;;
            *)
                echo "Unknown argument: $arg"
                show_help
                exit 1
                ;;
        esac
    done
    if [[ -z "$AUR_HELPER" ]]; then
    echo -e "Error: --aur-helper=[yay|paru] is required.\n"
    show_help
    exit 1
    fi

    # Ensure it's only yay or paru
    if [[ "$AUR_HELPER" != "yay" && "$AUR_HELPER" != "paru" ]]; then
        echo "Error: '$AUR_HELPER' is not a valid helper. Choose 'yay' or 'paru'."
        exit 1
    fi
}
getdistro() {
if [ -f /etc/os-release ]; then
    . /etc/os-release
    
    # Check for known Arch-based IDs
    if [[ "$ID" != "arch" && "$ID_LIKE" != *"arch"* ]]; then
        echo -e "\033[1;33m[!] WARNING: Distro not officially supported.\033[0m"
        echo "Detected: $NAME"
        echo "This script is designed for Arch-based systems."
        echo ""
        read -p "Do you want to attempt the installation anyway? [y/N]: " confirm
        
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo "Installation aborted by user."
            exit 1
        fi
    else
        echo -e "\033[0;34m[✓] System verified: $NAME detected.\033[0m"
    fi
else
    echo -e "\033[1;31m[!] Error: /etc/os-release not found.\033[0m"
    exit 1
fi
}
cleanup() {
    echo -e "\n\033[1;31m[!] Install aborted by user\033[0m"
    [ -n "$SUDO_PID" ] && kill "$SUDO_PID" 2>/dev/null
    sudo -k
    rm -rf /tmp/yay-bin /tmp/paru-bin 2>/dev/null
    
    exit 1
}
install_aur_helper() {
    local helper=$1
    if ! command -v "$helper" &> /dev/null; then
        echo -e "\033[0;34m[→] $helper not found. Installing from AUR...\033[0m"
        
        # Ensure git and base-devel are there (needed to build any AUR package)
        sudo pacman -S --needed $CONFIRM_FLAG git base-devel

        git clone "https://aur.archlinux.org/${helper}-bin.git" "/tmp/${helper}-bin"
        
        # Move to directory and build
        # We use 'pushd' and 'popd' for cleaner directory navigation in scripts
        pushd "/tmp/${helper}-bin" > /dev/null || exit 1
        
        # makepkg -si: -s installs deps, -i installs the package
        makepkg -si $CONFIRM_FLAG
        
        popd > /dev/null || exit 1
        rm -rf "/tmp/${helper}-bin"
    else
        echo -e "\033[0;32m[✓] $helper is already installed.\033[0m"
    fi
}
confirm_install() {
    echo -e "\n\033[1;34m[!] Ready to begin installation.\033[0m"
    echo "Distro: $NAME"
    echo "Helper: $AUR_HELPER (will be installed if missing)"
    echo "VSCode: ${VSCODE_OPTION:-(none)}"
    echo "Confirm: ${CONFIRM_FLAG:-(Manual confirmation)}"
    echo -e "------------------------------------------\n"
    if [[ -z "$CONFIRM_FLAG" ]]; then
        read -p "Proceed with installation? [y/N]: " final_confirm
        if [[ ! "$final_confirm" =~ ^[Yy]$ ]]; then
            cleanup 
        fi
    fi

    echo -e "\033[0;32m[OK] Starting setup...\033[0m"
}
backup_config() {
    echo -e "\033[0;34m[→] Backing up existing configuration files...\033[0m"
    local DATE=$(date +%Y%m%d_%H%M%S)
    local BACKUP_DIR="$HOME/config_backup_$DATE"
    mkdir -p "$BACKUP_DIR"
    local targets=(ags btop fish foot hypr matugen starship.toml)
    for item in "${targets[@]}"; do
        if [ -e "$HOME/.config/$item" ]; then
            cp -rf "$HOME/.config/$item" "$BACKUP_DIR/" 2>/dev/null
            echo "    - Backed up $item"
        fi
    done
    echo -e "\033[0;32m[✓] Backup completed at: $BACKUP_DIR\033[0m"
}
update_system() {
    echo -e "\033[0;34m[→] Updating system packages...\033[0m"
    sudo pacman -Syu $CONFIRM_FLAG
    echo -e "\033[0;32m[✓] System update completed.\033[0m"
}
install_pacman_packages() {
    echo -e "\033[0;34m[→] Installing Pacman packages...\033[0m"
    sudo pacman -S $CONFIRM_FLAG pipewire-jack hyprland iwd foot thunar brightnessctl wireplumber polkit-gnome xdg-desktop-portal-hyprland qt6ct qt5ct blueman geoclue btop starship fish gvfs nss meson vala valadoc gobject-introspection libnotify
    if [[$? -ne 0 ]]; then
        echo -e "\033[1;31m[!] Error: Pacman package installation failed.\033[0m"
        exit 1
    fi
    echo -e "\033[0;32m[✓] Pacman packages installation completed.\033[0m"
}
install_aur_packages() {
    local helper=$1
    echo -e "\033[0;34m[→] Installing AUR packages using $helper...\033[0m"
    $helper -S $CONFIRM_FLAG aylurs-gtk-shell-git libastal-meta matugen awww-bin
    if [[ $? -ne 0 ]]; then
        echo -e "\033[1;31m[!] Error: AUR package installation failed.\033[0m"
        exit 1
    fi 
    echo -e "\033[0;32m[✓] AUR packages installation completed.\033[0m"
}
install_dotfiles() {
    echo -e "\033[0;34m[→] Cleaning and installing dotfiles...\033[0m"
    mkdir -p "$HOME/Wallpapers"
    cp ./DefaultWallpaper/morningafter.JPG "$HOME/Wallpapers/Default_Wallpaper.jpg"
    mkdir -p "$HOME/Downloads"
    local targets=(ags btop fish foot hypr matugen starship.toml)
    for item in "${targets[@]}"; do
        if [ -e "$HOME/.config/$item" ]; then
            rm -rf "$HOME/.config/$item"
        fi
        if [ -e "./config/$item" ]; then
            cp -rf "./config/$item" "$HOME/.config/$item"
            echo "    - Installed $item"
        else
            echo -e "\033[1;33m    [!] Warning: $item not found in repo source.\033[0m"
        fi
    done
    echo -e "\033[0;32m[✓] Dotfiles installation completed.\033[0m"
}
install_zen_browser() {
    local option=$1
    if [[ "$option" == "yes" ]]; then
        echo -e "\033[0;34m[→] Installing Zen Browser...\033[0m"
        $AUR_HELPER -S zen-browser-bin $CONFIRM_FLAG
        echo -e "\033[0;32m[✓] Zen Browser installation completed.\033[0m"
    else
        echo -e "\033[0;34m[→] No Zen Browser option selected. Skipping installation...\033[0m"
    fi
}
install_vscode() {
    local option=$1
    if [[ "$option" == "vscode" ]]; then
        echo -e "\033[0;34m[→] Installing Visual Studio Code...\033[0m"
        $AUR_HELPER -S visual-studio-code-bin $CONFIRM_FLAG
        echo -e "\033[0;32m[✓] Visual Studio Code installation completed.\033[0m"
    elif [[ "$option" == "code" ]]; then
        echo -e "\033[0;34m[→] Installing Code - OSS...\033[0m"
        $AUR_HELPER -S code $CONFIRM_FLAG
        echo -e "\033[0;32m[✓] Code - OSS installation completed.\033[0m"
    else
        echo -e "\033[0;34m[→] No VSCode option selected. Skipping installation...\033[0m"
    fi
}
check_requirements() {
    echo -e "\033[0;34m[→] Checking environment...\033[0m"
    if ! command -v iwctl &> /dev/null; then
        echo -e "\033[1;31m[!] Error: iwd is not installed.\033[0m"
        echo "My configurations use iwdctl for networking. Please install 'iwd' first."
        exit 1
    fi
    if ! systemctl is-active --quiet iwd; then
        echo -e "\033[1;33m[!] Warning: iwd service is not active.\033[0m"
        echo "Networking components in the UI may not work until you start 'iwd'."
    fi

    echo -e "\033[0;32m[✓] Environment check passed.\033[0m"
}
main() {
    trap cleanup SIGINT SIGTERM
    getargs "$@"
    getdistro
    check_requirements
    confirm_install
    sudo_prime
    # HYPER RARE BUT POSSIBLE
    mkdir -p "$HOME/.config"


    # Installation commands
    backup_config
    update_system
    install_aur_helper "$AUR_HELPER"
    install_pacman_packages
    install_aur_packages "$AUR_HELPER"
    install_vscode "$VSCODE_OPTION"
    install_zen_browser "$ZEN_BROWSER_OPTION"
    install_dotfiles

    # End of installation commands
    echo -e "\033[0;32m[✓] Installation completed successfully!\033[0m"
    echo "If you are running Hyprland, please restart your session to apply all changes."

    # Clean up background sudo process and lock sudo
    [ -n "$SUDO_PID" ] && kill "$SUDO_PID" 2>/dev/null
    sudo -k
    exit 0
}
main "$@"
