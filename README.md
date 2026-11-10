# Dělení buňky

An interactive model of mitosis and meiosis in Czech, for a gymnázium student. No build step,
no dependencies, no server: each version is one HTML file.

- **v1** — `site/index.html` · https://deleni-bunky.pages.dev/ · 2D canvas, scrubber, labels, a phase quiz.
- **v2** — `site/v2/index.html` · https://deleni-bunky.pages.dev/v2/ · procedural 3D (raw WebGL), numbered parts
  that open into detail, four lesson steps (Prohlížej, Najdi, Pojmenuj, Seřaď), optional narration that
  drives the animation and marks the spoken word.

The model uses 2n = 4. Both divisions run from one keyframed state function (`divState`), so
meiosis II starts exactly where meiosis I ends.

## Check

    node test.mjs

Sweeps both modes at desktop and phone width, checks the chromosome counts, the seam between the
two meiotic divisions, that the four gametes differ, that the spindle never crosses an intact
nuclear envelope, and walks every lesson step and the narration. Needs Playwright (the path at the
top of the file) and Google Chrome.

## Narration

    node voice/dump.mjs && voice/build.py

`dump.mjs` reads the text from the page; `build.py` speaks it with Piper `cs_CZ-jirka-medium`
(CC0 dataset; put the `.onnx` and `.onnx.json` in `voice/models/`) and takes word times from
Whisper listening to the result. Re-run both after any change to a phase's name, tip or description.

## Content

Written at gymnázium level and checked by two independent reviews against standard sources;
corrections applied on 2026-11-10. `SIGNATURE.md` lists the teaching ideas behind v2 and where
they come from.
