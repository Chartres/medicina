#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mlx-whisper", "soundfile", "numpy"]
# ///
"""Narration for a lesson: one clip per step plus the start time of every word on the page.

  node voice/dump.mjs <slug> && voice/build.py <slug>

Voice: Piper cs_CZ-jirka-medium (local, CC0 dataset; the .onnx and .onnx.json go in voice/models/).
Word times come from Whisper listening to the finished clip, matched back to the page's words; a
word Whisper heard differently takes a time between its neighbours. Clips whose transcript matches
under 70 % of the words fail loudly. The contract test fails when the text changes after this ran.
"""
import difflib, json, os, pathlib, re, subprocess, sys, tempfile, unicodedata
os.environ.setdefault("HF_HUB_OFFLINE", "1")
import mlx_whisper, soundfile as sf

HERE = pathlib.Path(__file__).parent
# models live in the main checkout even when this runs from a git worktree
MODELS = pathlib.Path(os.environ.get("MEDICINA_VOICE_MODELS", HERE / "models"))
MODEL = MODELS / "cs_CZ-jirka-medium.onnx"
# how to say what the page writes; one page word stays one entry
SAY = {"I": "jedna", "II": "dvě", "III": "tři", "DNA": "dé en á", "RNA": "er en á", "mRNA": "em er en á", "tRNA": "té er en á",
       "rRNA": "er er en á", "ATP": "á té pé", "ADP": "á dé pé", "pH": "pé há", "CO₂": "cé ó dvě", "O₂": "ó dvě", "H₂O": "há dvě ó"}


def spoken(word):
    core = word.strip(".,;:!?()")
    return word.replace(core, SAY[core]) if core in SAY else word


def key(w):
    w = unicodedata.normalize("NFD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


def clip(parts, dest):
    words = [w for part in parts for w in part.split()]
    text = ". ".join(" ".join(spoken(w) for w in part.split()).rstrip(".") for part in parts) + "."
    with tempfile.TemporaryDirectory() as tmp:
        wav = f"{tmp}/a.wav"
        subprocess.run(["uvx", "--from", "piper-tts", "piper", "-m", str(MODEL), "-f", wav,
                        "--length-scale", "1.03", "--sentence-silence", "0.4"], input=text.encode(), check=True, capture_output=True)
        dur = sf.info(wav).duration
        heard = [w for s in mlx_whisper.transcribe(wav, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="cs",
                                                   word_timestamps=True)["segments"] for w in s["words"]]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1", "-c:a", "aac", "-b:a", "56k",
                        "-movflags", "+faststart", str(dest)], check=True)
    times = [None] * len(words)
    sm = difflib.SequenceMatcher(None, [key(w) for w in words], [key(w["word"]) for w in heard], autojunk=False)
    for a, b, n in sm.get_matching_blocks():
        for k in range(n):
            times[a + k] = heard[b + k]["start"]
    hit = sum(t is not None for t in times) / len(words)
    # unmatched words: spread evenly between the matched neighbours
    known = [(-1, 0.0)] + [(i, t) for i, t in enumerate(times) if t is not None] + [(len(words), dur)]
    for (i0, t0), (i1, t1) in zip(known, known[1:]):
        for i in range(i0 + 1, i1):
            times[i] = t0 + (t1 - t0) * (i - i0) / (i1 - i0)
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1])
    assert hit >= 0.7, f"{dest.name}: only {hit:.0%} of words recognised — synthesis or alignment is off"
    assert 1.2 <= len(words) / dur <= 3.5, f"{dest.name}: {len(words)} words in {dur:.0f}s"
    return {"dur": round(dur, 2), "w": [round(t, 2) for t in times]}, hit


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: voice/build.py <slug>")
    src = json.loads((HERE / "narration" / f"{sys.argv[1]}.json").read_text())
    SAY.update(src["pronounce"])
    out = HERE.parent / "public" / src["slug"] / "audio"
    out.mkdir(parents=True, exist_ok=True)
    data, worst = {}, 1
    for track, clips in src["tracks"].items():
        data[track] = []
        for i, parts in enumerate(clips):
            entry, hit = clip(parts, out / f"{track}-{i}.m4a")
            worst = min(worst, hit)
            print(f"{track}-{i}: {entry['dur']:.0f}s, {hit:.0%} matched", file=sys.stderr)
            data[track].append(entry)
    (out / "timings.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"ok, worst match {worst:.0%}")


if __name__ == "__main__":
    main()
