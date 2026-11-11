# The lesson builder

A premium member files a lesson request in the web app. This job, on Pavol's Mac mini, takes the
oldest queued request, has a headless Claude Code session (his Max subscription) build the lesson,
then checks, publishes and verifies it outside the agent and writes the status back to the queue.

    node builder/run.mjs                    one run: at most one request (launchd does this every 10 min)
    node builder/run.mjs --request <id>     build that request by hand (queued or failed); skips the daily budget
    node builder/run.mjs --dry-run          prepare everything, print the prompt, stop before the session; changes no status
    node builder/run.mjs --probe            test the containment for real; touches no queue

## What one run does

1. Takes the lock `~/.cache/medicina-builder/lock` (a lock whose process is gone is taken over). With
   the lock held, any request still `building` or `checking` after two hours is marked `failed`.
2. Budget: if three requests left `queued` in the last 24 hours, it exits and leaves the queue alone.
3. Claims the oldest `queued` row in one `update … returning` and sets `building`.
4. Checks the row (it is user input) and downloads the photos to `~/.cache/medicina-builder/<request id>/`.
   A file that is not a JPEG, PNG or WebP under 6 MB fails the build. The folder is deleted when the build ends.
5. Fetches `main` into its own bare clone (`repo.git`) and makes two directories:
   - `box/<id>`: the session's copy of the repository, a separate clone.
   - `wt/<id>`: a clean worktree on branch `lesson/<id>`. Only `run.mjs` writes here.
6. Runs the session in the box (`claude -p`, model pinned, 100 minutes for all its turns together).
   The prompt is `builder/prompt.md`; it names the request file and the photos and carries none of
   the request's text. The session ends with `LESSON_SLUG: <slug>` or `LESSON_REJECT: <reason>`.
7. Sets `checking`. Refuses the result if anything outside `<slug>/`, `src/lessons/<slug>/`,
   `public/<slug>/` and `voice/narration/<slug>.json` changed, if the slug is taken (new) or is not
   the requested lesson (revise), or if the lesson holds a symlink.
8. Runs the checks (`STEPS` in `run.mjs`): `npm ci`, narration text, narration audio, typecheck,
   tests, build, and the browser walk-through. When one fails the session is called again with the
   report; when they pass it is called once more to look at the screenshots. Four session turns at most.
9. Copies the lesson's files into the clean worktree, commits, pushes `lesson/<id>`, opens the pull
   request, checks on GitHub that the pull request is that commit and holds lesson files only, waits
   for `gh pr checks --watch` to exit 0, and only then merges (`--squash --delete-branch
   --match-head-commit`). Never `gh pr merge --auto`: with no required checks it merges at once.
10. Polls `https://medicina.dravec.org/<slug>/build.json` (a marker the builder commits) for up to
    15 minutes, then sets `live` with `result_url`.
11. Any failure sets `failed` with "Stavba se nepovedla. Pavol o tom ví."; the reason goes to the log.
    A failed build that produced a lesson keeps `box/<id>` and `wt/<id>` for a week.
12. Tells Pavol: one typed note to `think/say/say-inbox`, which becomes one push to his phone.

## Containment

The request is text and photos from a web form. Three rules follow from that.

**The session runs inside Claude Code's own sandbox.** Flags and settings (`claudeSettings` in `run.mjs`):

- `--restricted`: no user or project settings, so none of Pavol's plugins, hooks or MCP servers load;
  the file tools are confined to the box and the request folder; `bypassPermissions` is refused.
- `--tools Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch`, `--strict-mcp-config`, `--disallowedTools mcp__*`,
  `ENABLE_CLAUDEAI_MCP_SERVERS=false`: no Gmail, Supabase, Drive or other connectors.
- `--permission-mode dontAsk --permission-prompts none`: nothing waits for an answer.
- `sandbox.enabled`, `failIfUnavailable`, `allowUnsandboxedCommands: false`: every shell command runs
  under macOS Seatbelt, and the escape hatch is off. Reads of `/Users`, `/Volumes`, `/private/tmp`
  and `/private/var/folders` are denied except the box, the request folder, the builder's own temp
  folder and npm cache. Writes go to the box, that temp folder and that npm cache. The network is
  `registry.npmjs.org` only (`strictAllowlist`), with no local ports.
- The process gets a short fixed environment (`envs` in `run.mjs`), not the builder's own.

**Checks that execute lesson code run in the same sandbox**, through `@anthropic-ai/sandbox-runtime`
(`srt`, the engine Claude Code's sandbox is built on), with the same boundary.

**The host never runs anything from the box.** Chrome and the GPU do not work inside the sandbox
(below), so the narration audio and the browser walk-through run on the host, in the clean
worktree, from scripts that are byte for byte those on `main`. Lesson files reach the worktree by a
copy that takes plain files only, made while the box is moved aside to a folder no sandbox can write.
`voice/build.py` builds file names from the narration JSON, so `run.mjs` checks that file's shape first.

Pavol's notification is made of fixed words, the request id, the slug and the pull request number.
It never carries request text or model output, because `say-inbox` starts a full-trust agent on it.

### Probe, 2026-11-11, Claude Code 2.1.319, macOS 27.0.1

`node builder/run.mjs --probe` runs `builder/probe.sh` under `srt` and inside a real `claude -p`
session (claude-fable-5-1), with the settings a build uses. Both runs gave the same 27 lines:

| Tried from inside | Result |
| :- | :- |
| read `~/.supabase_pat`, `~/.ssh`, `~/.config/gh`, `~/Library/Keychains`, `~/.claude/settings.json`, `~/.claude.json`, `~/my-git`, `~/.zshrc`, the builder's logs and clean repo, `/private/tmp` | blocked |
| `security find-generic-password` for a keychain item, `gh auth token` | blocked |
| write to `$HOME`, `/private/tmp`, the builder's cache, `.claude/settings.json` in the box | blocked |
| `curl` to example.com, the same with `--noproxy`, a bare IP, api.github.com, api.supabase.com | blocked |
| `curl` to a service on `127.0.0.1`, listening on a port | blocked |
| write in the box and in `$TMPDIR`, reach `registry.npmjs.org` | works |

Earlier runs the same day (claude-sonnet-5-5) showed the rest: a Bash call with
`dangerouslyDisableSandbox: true` still ran sandboxed; `Read` and `Write` outside the box were
refused with "--restricted confines the file tools to the working directory"; the session listed
exactly the eight tools above and no MCP server. `npm ci`, `npm run typecheck`, `npm test` and
`npm run build` pass inside the sandbox.

### What is not contained

- **WebFetch and WebSearch run inside Claude Code, not in the sandbox.** A session that was talked
  into it could send out what it can read: the repository (public), the request text and the photos.
  It cannot read anything else.
- **No browser and no GPU in the sandbox.** System Chrome dies at start (`FATAL base/mac/mac_util.mm:379
  Operation not permitted`; the profile denies sysctls it needs), Playwright's Chromium dies on
  `bootstrap_check_in … MachPortRendezvousServer: Permission denied`, and MLX reports `No Metal device
  available`. The sandbox has no setting for these. So the session cannot open its lesson; it sees
  the screenshots the host walk-through puts in `shots/<slug>/` when it is called again.
- **The walk-through opens the lesson in real Chrome on the host.** Chrome's own sandbox is the
  boundary there. The page has the host's network, so a hostile page could call services on
  localhost that act without a login. Blocking every request that is not `localhost:8765` in
  `e2e/lesson.mjs` closes this.
- **The lesson is published without a person reading it.** It is JavaScript on the same origin as
  the sign-in. The checks prove it works, not that it is harmless.
- macOS Seatbelt is a path and host filter, not a virtual machine; `sandbox-runtime` is a beta.

## Install, logs, stop

    builder/install.sh              # installs srt 0.0.82 under ~/.cache/medicina-builder/srt, runs --probe, loads org.dravec.medicina-builder
    builder/install.sh uninstall    # unloads the job; a running build finishes

The job runs `run.mjs` from this checkout, on whatever branch it is on. To stop a running build,
kill the pid in `~/.cache/medicina-builder/lock`; the next run takes the lock over and, two hours
later, marks the request `failed`.

Everything is under `~/.cache/medicina-builder/`:

| Path | What |
| :- | :- |
| `logs/launchd.out`, `launchd.err` | every run |
| `logs/<time>-<id>.log` | one build: each step, the tail of each check's output, the failure |
| `logs/<time>-<id>.session.jsonl` | the session's transcript (stream-json; photo bytes left out) |
| `logs/<time>-<id>.settings.json`, `.srt.json` | the sandbox settings that build used |
| `logs/notify.log` | what `say-inbox` printed |
| `box/<id>`, `wt/<id>` | kept after a failed build, removed after a week |

Settings: `MEDICINA_BUILDER_MODEL` (default `claude-fable-5-1`; `claude-opus-5-5` and
`claude-sonnet-5-5` also answered `claude -p hello` on this account on 2026-11-11) and
`MEDICINA_BUILDER_TIMEOUT_MIN` (default 100).

## What the builder expects from the rest of the repository

- The queue is `public.medicina_requests` as in `supabase/migrations/`, with `updated_at` moved by a trigger.
  Attachments are `<user id>/<request id>/<name>.jpg|png|webp` in the private bucket `medicina-requests`.
- A lesson is exactly the four paths in step 7 and is found without editing a shared file.
- `node voice/dump.mjs <slug>`, `voice/build.py <slug>` (reads `MEDICINA_VOICE_MODELS`) and
  `node e2e/lesson.mjs <slug>` take a slug. The last two run on the host: they must not import or
  execute a file from the lesson's paths. `vite.config.ts` must not either.
- `e2e/lesson.mjs` writes screenshots to `shots/<slug>/`.
- `.gitignore` covers `node_modules/`, `dist/` and `shots/`.
- CI runs on pull requests, so `gh pr checks` has something to wait for.

Tests: `node --test builder/run.test.mjs` (part of `npm test`). Every outside effect is a stub; git
runs for real against a throwaway repository.
