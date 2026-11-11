#!/bin/sh
# What can a process inside the builder's sandbox reach? Run by `node builder/run.mjs --probe`, once
# under the sandbox runtime (as the checks run) and once by a contained Claude session. Each line is
# PASS or FAIL against what the builder relies on. Prints exit codes only, never a file's contents.
no() { name=$1; shift; if "$@" >/dev/null 2>&1; then echo "FAIL $name: allowed, must be blocked"; else echo "PASS $name: blocked"; fi; }
ok() { name=$1; shift; if "$@" >/dev/null 2>&1; then echo "PASS $name: works"; else echo "FAIL $name: blocked, the build needs it"; fi; }
get() { curl -sS -m 12 -o /dev/null "$@"; }
C="$HOME/.cache/medicina-builder"

no read-supabase-token cat "$HOME/.supabase_pat"
no read-ssh ls "$HOME/.ssh"
no read-gh-config ls "$HOME/.config/gh"
no read-keychains ls "$HOME/Library/Keychains"
no read-claude-settings cat "$HOME/.claude/settings.json"
no read-claude-json cat "$HOME/.claude.json"
no read-other-repos ls "$HOME/my-git"
no read-shell-profile cat "$HOME/.zshrc"
no read-builder-logs ls "$C/logs"
no read-clean-repo ls "$C/repo.git"
no read-system-tmp ls /private/tmp
no keychain-item security find-generic-password -s telegram-bot-token -w
no gh-token gh auth token
no write-home touch "$HOME/medicina-probe"
no write-system-tmp touch /private/tmp/medicina-probe
no write-builder-cache touch "$C/medicina-probe"
no write-claude-settings-here sh -c 'mkdir -p .claude && echo "{}" > .claude/settings.json'
no net-any-host get https://example.com
no net-without-proxy get --noproxy '*' https://example.com
no net-ip get --noproxy '*' https://1.1.1.1
no net-github get https://api.github.com/zen
no net-supabase get https://api.supabase.com
no net-localhost-service get --noproxy '*' http://127.0.0.1:3001/
no listen-on-a-port node -e 'require("net").createServer().on("error",()=>process.exit(1)).listen(8765,"127.0.0.1",()=>process.exit(0))'
ok write-here touch probe-wrote-this
ok write-tmpdir touch "$TMPDIR/probe"
ok net-npm-registry get https://registry.npmjs.org/vite/latest
echo "TMPDIR=$TMPDIR"
