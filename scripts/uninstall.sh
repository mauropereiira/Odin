#!/usr/bin/env bash
set -euo pipefail

APP="/Applications/Odin.app"
APP_MARKER="odin-local-launcher-v1"
STATE_DIR="${HOME}/Library/Application Support/Odin"
LOG_DIR="${HOME}/Library/Logs/Odin"
APP_PID_FILE="${STATE_DIR}/app.pid"
PS="$(command -v ps)"
REMOVING_APP="${APP}.removing.$$"

restore_app() {
  [[ ! -d "${REMOVING_APP}" || -e "${APP}" ]] || /bin/mv "${REMOVING_APP}" "${APP}"
}

is_odin_app_bundle() {
  local bundle="$1"
  local marker="${bundle}/Contents/Resources/odin-app.marker"
  local helper="${bundle}/Contents/Resources/odin-launcher.sh"
  local value=""
  [[ -d "${bundle}" && ! -L "${bundle}" ]] || return 1
  if [[ -r "${marker}" ]]; then
    IFS= read -r value < "${marker}" || return 1
    [[ "${value}" == "${APP_MARKER}" ]]
    return
  fi
  [[ -x "${helper}" ]] && /usr/bin/grep -Fq 'ODIN_LAUNCHER_INSTANCE' "${helper}"
}

process_command() {
  "${PS}" -ww -p "$1" -o command= 2>/dev/null
}

is_registered_app() {
  local command
  command="$(process_command "$1")" || return 1
  [[ "${command}" == "${APP}/Contents/MacOS/applet"* || "${command}" == "${REMOVING_APP}/Contents/MacOS/applet"* ]]
}

stop_registered_app() {
  local app_pid=""
  local pid command
  local i
  if [[ -r "${APP_PID_FILE}" ]]; then
    IFS= read -r app_pid < "${APP_PID_FILE}" || app_pid=""
    if [[ "${app_pid}" =~ ^[0-9]+$ ]] && is_registered_app "${app_pid}"; then
      kill -TERM "${app_pid}" 2>/dev/null || true
    fi
  fi

  # Also catch a forced second instance or an app whose registration was lost.
  while read -r pid command; do
    [[ "${pid}" =~ ^[0-9]+$ ]] || continue
    if [[ "${command}" == "${APP}/Contents/MacOS/applet"* || "${command}" == "${REMOVING_APP}/Contents/MacOS/applet"* ]]; then
      is_registered_app "${pid}" || continue
      kill -TERM "${pid}" 2>/dev/null || true
      for i in {1..20}; do
        is_registered_app "${pid}" || break
        /bin/sleep 0.1
      done
      if is_registered_app "${pid}"; then
        kill -KILL "${pid}" 2>/dev/null || true
      fi
    fi
  done < <("${PS}" -axo pid=,command=)
}

if [[ ( -e "${APP}" || -L "${APP}" ) ]] && ! is_odin_app_bundle "${APP}"; then
  echo "${APP} exists but is not an Odin installation; nothing was removed." >&2
  exit 1
fi

# Move the validated app out of its launchable path immediately, then verify
# the exact bundle moved. A concurrent replacement is never deleted.
if [[ -d "${APP}" ]]; then
  /bin/mv "${APP}" "${REMOVING_APP}"
  if ! is_odin_app_bundle "${REMOVING_APP}"; then
    restore_app
    echo "The application changed while uninstall was starting; nothing was removed." >&2
    exit 1
  fi
fi

# Stop the recorded app after the owned bundle is no longer launchable, so its
# idle handler cannot restart the server during removal.
stop_registered_app

# Once the bundle is no longer launchable, use its authoritative checkout path
# to stop the owned server. Restore the app if ownership cannot be verified.
HELPER="${REMOVING_APP}/Contents/Resources/odin-launcher.sh"
if [[ ! -x "${HELPER}" && -r "${STATE_DIR}/server.state" ]]; then
  restore_app
  echo "Odin's launcher is missing or damaged; nothing was removed." >&2
  exit 1
fi
if [[ -x "${HELPER}" ]] && ! /bin/bash "${HELPER}" stop >/dev/null 2>&1; then
  restore_app
  echo "Odin's launcher is busy or damaged; nothing was removed." >&2
  exit 1
fi
stop_registered_app
if [[ -x "${HELPER}" ]] && ! /bin/bash "${HELPER}" stop >/dev/null 2>&1; then
  restore_app
  echo "Odin restarted while uninstalling; nothing was removed." >&2
  exit 1
fi

/bin/rm -rf "${REMOVING_APP}" "${STATE_DIR}" "${LOG_DIR}"
echo "Removed Odin.app, its launcher state/logs, and any server owned by it."
