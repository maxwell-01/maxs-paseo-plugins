#!/usr/bin/env bash
# A throwaway Paseo daemon for trying a plugin build without touching your real one.
#
#   scripts/paseo-sandbox.sh up                  start it; prints the browser app URL
#   scripts/paseo-sandbox.sh install <source>    paseo plugin install into it (a folder, git or npm source)
#   scripts/paseo-sandbox.sh paseo <args...>     any paseo command against it, e.g. plugin logs <id>
#   scripts/paseo-sandbox.sh down                stop it and delete its home
#
# PASEO_SANDBOX_HOME (default /tmp/paseo-check) and PASEO_SANDBOX_PORT (default 6799) override the defaults.
set -euo pipefail

home="${PASEO_SANDBOX_HOME:-/tmp/paseo-check}"
port="${PASEO_SANDBOX_PORT:-6799}"
marker="$home/.paseo-sandbox"
cli="${PASEO_CLI:-paseo}"

if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "refusing: port $port is not a number" >&2
  exit 1
fi

refuse_real_paseo() {
  local sandbox_home real_home
  sandbox_home="$(cd "$home" && pwd -P)"
  real_home="$(cd "$HOME/.paseo" 2>/dev/null && pwd -P || true)"
  if [[ "$sandbox_home" == "$real_home" || "$sandbox_home" == "$(cd "$HOME" && pwd -P)" || 10#$port -eq 6767 ]]; then
    echo "refusing: $home on port $port is, or would clash with, your real Paseo" >&2
    exit 1
  fi
}

[[ -d "$home" ]] && refuse_real_paseo

sandbox_paseo() { env -u PASEO_HOST PASEO_HOME="$home" "$cli" "$@"; }

# The built-in providers are off from the first start; this also catches any a newer Paseo adds.
disable_every_provider() {
  local providers
  providers="$(sandbox_paseo provider ls --json | node -e '
    const list = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log(JSON.stringify(Object.fromEntries(list.map((p) => [p.provider, { enabled: false }]))));
  ')"
  sandbox_paseo daemon config set agents.providers "$providers" >/dev/null
  sandbox_paseo provider ls --json | node -e '
    const on = JSON.parse(require("fs").readFileSync(0, "utf8")).filter((p) => p.enabled !== "Disabled");
    if (on.length) { console.error("providers still enabled: " + on.map((p) => p.provider)); process.exit(1); }
  '
}

case "${1:-}" in
  up)
    mkdir -p "$home"
    refuse_real_paseo
    if [[ -n "$(ls -A "$home")" && ! -e "$marker" ]]; then
      echo "refusing: $home is not empty and was not made by this script" >&2
      exit 1
    fi
    touch "$marker"
    cat >"$home/config.json" <<JSON
{
  "version": 1,
  "daemon": { "listen": "127.0.0.1:$port", "relay": { "enabled": false }, "usage": { "enabled": false } },
  "pluginsEnabled": true,
  "features": { "webUi": { "enabled": true } },
  "agents": { "providers": {
    "claude": { "enabled": false }, "codex": { "enabled": false }, "copilot": { "enabled": false },
    "opencode": { "enabled": false }, "pi": { "enabled": false }, "omp": { "enabled": false },
    "antigravity": { "enabled": false }, "muse": { "enabled": false }
  } }
}
JSON
    sandbox_paseo daemon start
    if ! disable_every_provider; then
      sandbox_paseo daemon stop
      exit 1
    fi
    echo "Sandbox Paseo: http://127.0.0.1:$port/ (home $home, no agent providers)"
    ;;
  install)
    shift
    [[ -d "${1:-}" ]] && set -- "$(cd "$1" && pwd -P)" "${@:2}"
    sandbox_paseo plugin install "$@" </dev/null
    ;;
  paseo)
    shift
    sandbox_paseo "$@"
    ;;
  down)
    if [[ ! -e "$marker" ]]; then
      echo "refusing: $home was not made by this script" >&2
      exit 1
    fi
    if ! sandbox_paseo daemon stop && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
      echo "the sandbox daemon is still running on port $port; $home kept" >&2
      exit 1
    fi
    rm -rf "$home"
    echo "Sandbox Paseo stopped and $home deleted"
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
