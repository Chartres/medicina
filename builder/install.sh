#!/bin/zsh
# Install or remove the lesson builder's launchd job on this Mac. Safe to run again.
#   builder/install.sh             install the sandbox runtime, prove the containment, load the job
#   builder/install.sh uninstall   unload the job and remove its plist (cache and logs stay)
set -euo pipefail
REPO=${0:A:h:h}
LABEL=org.dravec.medicina-builder
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
CACHE=$HOME/.cache/medicina-builder
SRT_VERSION=0.0.82   # @anthropic-ai/sandbox-runtime, the engine of Claude Code's own sandbox; bump on purpose, then run --probe

launchctl bootout gui/$UID/$LABEL 2>/dev/null || true
if [[ ${1:-} == uninstall ]]; then
  rm -f $PLIST
  echo "$LABEL unloaded. A build that is running finishes; its pid is in $CACHE/lock."
  exit 0
fi

for c in claude gh git node npm uv ffmpeg; do
  command -v $c >/dev/null || { echo "missing on PATH: $c" >&2; exit 1 }
done
[[ -f $HOME/.supabase_pat ]] || { echo "missing ~/.supabase_pat (Supabase personal access token)" >&2; exit 1 }
[[ -d "/Applications/Google Chrome.app" ]] || { echo "missing Google Chrome (the lesson walk-through needs it)" >&2; exit 1 }

mkdir -p $CACHE/logs
if ! grep -qs "\"version\": \"$SRT_VERSION\"" $CACHE/srt/node_modules/@anthropic-ai/sandbox-runtime/package.json; then
  npm install --silent --no-audit --no-fund --prefix $CACHE/srt @anthropic-ai/sandbox-runtime@$SRT_VERSION
fi

# No job without a boundary: the probe runs builder/probe.sh in both sandboxes and fails on any leak.
(cd $REPO && node builder/run.mjs --probe) || { echo "containment probe failed: job NOT loaded" >&2; exit 1 }

sed -e "s|@REPO@|$REPO|g" -e "s|@HOME@|$HOME|g" $REPO/builder/$LABEL.plist.template > $PLIST
launchctl bootstrap gui/$UID $PLIST
echo "$LABEL loaded: one request every 10 minutes at most, logs in $CACHE/logs"
