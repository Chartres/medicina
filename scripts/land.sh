#!/bin/zsh
# Merge a pull request only after its checks have passed. Usage: scripts/land.sh <pr number>
# `gh pr merge --auto` does not wait in this account's repos (no required checks), and a watch whose exit
# code is not looked at is no gate either: both mistakes have merged red commits here.
set -euo pipefail
pr=$1
sleep 5
until gh pr checks $pr >/dev/null 2>&1 || ! gh pr checks $pr 2>&1 | grep -q "no checks reported"; do sleep 5; done
gh pr checks $pr --watch --interval 10 >/dev/null || { echo "checks on #$pr FAILED: not merged"; gh pr checks $pr | cat; exit 1 }
head=$(gh pr view $pr --json headRefOid -q .headRefOid)
[[ $head == $(git rev-parse HEAD) ]] || { echo "#$pr head $head is not the local HEAD: not merged"; exit 1 }
gh pr merge $pr --squash --delete-branch --match-head-commit $head
