#!/bin/bash
# Team Tour Launcher: shows which server Multiplayer is on, lets you switch it, or starts Balatro.
# Default path is the Proton prefix the Multiplayer launcher uses; set BALATRO_DIR to override.
# Test seams: SWITCH_CHOICE is a comma-separated script of actions (switch, play, quit), one per
# prompt; NO_LAUNCH=1 prints the launch command instead of running it; NO_DESKTOP_INSTALL=1 skips the
# app-menu entry.
B="${BALATRO_DIR:-$HOME/.steam/steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro}"
queue="$SWITCH_CHOICE"
scripted=""
[ -n "${SWITCH_CHOICE+x}" ] && scripted=1

# First run (or after the file moves): add an app-menu entry with the icon. NO_DESKTOP_INSTALL=1 skips it.
install_desktop_entry() {
  [ -n "$NO_DESKTOP_INSTALL" ] && return 0
  local self dir apps icons entry
  self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  case "$self" in *'"'* | *'$'* | *'`'* | *'\'* | *'%'*) return 0 ;; esac
  dir="$(dirname "$self")"
  apps="$HOME/.local/share/applications"
  icons="$HOME/.local/share/icons/hicolor/256x256/apps"
  entry="$apps/team-tour-launcher.desktop"
  if [ -f "$entry" ] && grep -qxF "Exec=bash \"$self\"" "$entry"; then return 0; fi
  mkdir -p "$apps" "$icons" || return 0
  [ -f "$dir/team-tour-launcher.png" ] && cp "$dir/team-tour-launcher.png" "$icons/team-tour-launcher.png"
  {
    echo "[Desktop Entry]"
    echo "Type=Application"
    echo "Name=Team Tour Launcher"
    echo "Comment=Switch Balatro Multiplayer between the Team Tour and public servers, or start Balatro"
    echo "Exec=bash \"$self\""
    echo "Icon=team-tour-launcher"
    echo "Terminal=true"
    echo "Categories=Game;"
  } > "$entry" || return 0
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps" >/dev/null 2>&1
  echo "Added Team Tour Launcher to your app menu."
  return 0
}
install_desktop_entry


# A folder is the Multiplayer mod only if Multiplayer.json has the top-level id "Multiplayer" (what
# the official Multiplayer launcher checks) AND its core.lua mentions MP.ENV, i.e. this version
# reads a .env. The same test selects every folder we write to or delete from.
mp_id() {
  if [ -z "$NO_PYTHON" ] && python3 -c "import json" >/dev/null 2>&1; then
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1], encoding="utf-8-sig")); print(d.get("id", "") if isinstance(d, dict) else "")' "$1" 2>/dev/null
  else
    # No python3: match only "id": "Multiplayer" with the closing quote right after the word, so
    # "NanoMultiplayer" or "MultiplayerX" cannot match. It cannot tell top level from nested keys.
    grep -Eq '"id"[[:space:]]*:[[:space:]]*"Multiplayer"' "$1" 2>/dev/null && echo Multiplayer
  fi
}
qualifies() {
  [ -f "${1}Multiplayer.json" ] && [ "$(mp_id "${1}Multiplayer.json")" = "Multiplayer" ]     && [ -f "${1}core.lua" ] && grep -qF 'MP.ENV' "${1}core.lua"
}

scan() {
  found=""
  state="Public"
  for d in "$B/Mods"/*/; do
    if qualifies "$d"; then
      found=1
      [ -f "${d}.env" ] && state="Team Tour"
    fi
  done
}

launch() {
  if command -v xdg-open >/dev/null 2>&1; then
    if [ -n "$NO_LAUNCH" ]; then
      echo "LAUNCH: xdg-open steam://rungameid/2379780"
    else
      nohup xdg-open steam://rungameid/2379780 >/dev/null 2>&1 &
    fi
  else
    echo "Start Balatro the way you usually do."
  fi
}

scan
if [ -z "$found" ]; then
  echo "Could not find a current Multiplayer mod. Install or update it with the Multiplayer launcher."
  exit 0
fi

while true; do
  scan
  # Red = public, green = Team Tour.
  if [ "$state" = "Team Tour" ]; then col=32; stateword="Team Tour"; other="Public"; else col=31; stateword="public"; other="Team Tour"; fi
  printf '\033[%sm(*)\033[0m You are on the %s server.\n' "$col" "$stateword"
  if [ -n "$scripted" ]; then
    action="${queue%%,*}"
    if [ "$queue" = "${queue#*,}" ]; then queue=""; else queue="${queue#*,}"; fi
    [ -z "$action" ] && action="quit"
  else
    ans=""
    if [ -t 0 ]; then
      # Just Enter plays.
      read -r -p "[S] Switch to $other server  [P] Play Balatro  [Q] Quit (Enter = Play): " ans
      [ -z "$ans" ] && ans="p"
    elif [ -n "$DISPLAY$WAYLAND_DISPLAY" ] && command -v zenity >/dev/null 2>&1; then
      out=$(zenity --question --title "Team Tour Launcher" --text "You are on the $stateword server." \
        --ok-label "Play Balatro" --cancel-label "Quit" --extra-button "Switch to $other server")
      rc=$?
      if [ $rc -eq 0 ]; then ans="p"; elif [ -n "$out" ]; then ans="s"; else ans="q"; fi
    else
      read -r ans || ans="q"
    fi
    case "$(printf '%s' "$ans" | tr 'A-Z' 'a-z')" in
      s*) action="switch" ;;
      p*) action="play" ;;
      *) action="quit" ;;
    esac
  fi
  case "$action" in
    switch)
      if [ "$state" = "Team Tour" ]; then
        for d in "$B/Mods"/*/; do
          if qualifies "$d"; then rm -f "${d}.env"; fi
        done
        if [ -f "$B/config/Multiplayer.jkr" ]; then
          perl -pi -e 's/mp\.balatroleague\.com/balatro.virtualized.dev/g' "$B/config/Multiplayer.jkr"
        fi
      else
        for d in "$B/Mods"/*/; do
          if qualifies "$d"; then
            printf 'server_url=mp.balatroleague.com\nserver_port=8788\n' > "${d}.env"
          fi
        done
      fi
      ;;
    play)
      launch
      exit 0
      ;;
    *)
      echo "No change."
      exit 0
      ;;
  esac
done
