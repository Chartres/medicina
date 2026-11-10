# Na medicínu

Interactive biology lessons in Czech for medical-school entrance prep. Live at https://medicina.dravec.org.

- `/` — the course: lessons in workbook order, with the learner's progress.
- `/deleni-bunky/` — Buněčný cyklus a dělení buněk: procedural 3D (raw WebGL), numbered parts that open into detail, four lesson steps (Prohlížej, Najdi, Pojmenuj, Seřaď), optional narration that drives the animation and marks the spoken word.
- `/deleni-bunky/v1/` — the first, flat version of that lesson, kept as it was.

Progress is a set of marks kept in the browser; signing in (e-mail link or code, no password) syncs it between devices. Stack: Vite + TypeScript, no framework; see `AGENTS.md`.

The cell model uses 2n = 4. Both divisions run from one keyframed state function (`divState`), so
meiosis II starts exactly where meiosis I ends.

## Check

    npm test          # progress logic, signals contract
    npm run e2e       # builds, then walks the lesson in Chrome

Sweeps both modes at desktop and phone width, checks the chromosome counts, the seam between the
two meiotic divisions, that the four gametes differ, that the spindle never crosses an intact
nuclear envelope, and walks every lesson step and the narration. Needs Google Chrome.

## Narration

    node voice/dump.mjs && voice/build.py

`dump.mjs` reads the text from the page; `build.py` speaks it with Piper `cs_CZ-jirka-medium`
(CC0 dataset; put the `.onnx` and `.onnx.json` in `voice/models/`) and takes word times from
Whisper listening to the result. Re-run both after any change to a phase's name, tip or description.

## Content

Written at gymnázium level and checked by two independent reviews against standard sources;
corrections applied on 2026-11-10. `docs/SIGNATURE.md` lists the teaching ideas behind v2 and where
they come from.
