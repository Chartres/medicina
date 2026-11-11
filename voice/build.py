#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = "==3.11.*"
# dependencies = ["coqui-tts[codec]", "torch", "torchaudio", "six", "mlx-whisper", "soundfile", "numpy", "librosa"]
# ///
"""Narration for a lesson: one clip per step plus the start time of every word on the page.

  node voice/dump.mjs <slug> && voice/build.py <slug> [--only <track>-<i> …]

How it is paced. A step is read as its name, its one-line tip, then its description, sentence by
sentence. Each sentence is synthesized on its own, so every one gets its own melody and a real stop
after it, and the pauses are set here: a long one after the name, a shorter one after the tip, a
breath between sentences. (The first voice read each step as one block and droned.)

Voice: XTTS-v2 speaking Czech in the house voice (a designed voice, never a recording of a person;
the reference clip is voice/models/house.wav and stays out of the repository). The model's licence
(Coqui CPML) allows non-commercial use only: this course is free; if it ever charges, change the
voice first. `--engine piper` keeps the old Piper voice available without that limit.

Checks, per sentence: Whisper listens to it, and a sentence it cannot recognise (under 80 % of the
words, which is how this model's occasional slips show) is synthesized again, up to four times, then
the build fails. Word times come from the same listening, matched back to the page's words; a word
heard differently takes a time between its neighbours. The contract test fails when the lesson's
text changes after this ran.
"""
import argparse, difflib, json, os, pathlib, re, subprocess, sys, tempfile, unicodedata
os.environ.setdefault("COQUI_TOS_AGREED", "1")   # CPML, non-commercial: see above
import numpy as np, soundfile as sf, librosa, mlx_whisper

HERE = pathlib.Path(__file__).parent
# models and the voice reference live in the main checkout even when this runs from a git worktree
MODELS = pathlib.Path(os.environ.get("MEDICINA_VOICE_MODELS", HERE / "models"))
PAUSE = {"name": 0.85, "tip": 0.7, "sentence": 0.42, "end": 0.25}   # seconds of silence after each kind of line
SAY = {"I": "jedna", "II": "dvě", "III": "tři", "DNA": "dé en á", "RNA": "er en á", "mRNA": "em er en á", "tRNA": "té er en á",
       "rRNA": "er er en á", "ATP": "á té pé", "ADP": "á dé pé", "pH": "pé há", "CO₂": "cé ó dvě", "O₂": "ó dvě", "H₂O": "há dvě ó"}
WHISPER = "mlx-community/whisper-large-v3-turbo"


def spoken(word):
    core = word.strip(".,;:!?()")
    return word.replace(core, SAY[core]) if core in SAY else word


def key(w):
    w = unicodedata.normalize("NFD", w.lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


class Xtts:
    rate = 24000

    def __init__(self):
        from TTS.api import TTS
        self.tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        self.ref = str(MODELS / "house.wav")
        assert os.path.exists(self.ref), f"voice reference missing: {self.ref}"

    def say(self, text):
        return np.asarray(self.tts.tts(text=text, speaker_wav=self.ref, language="cs", split_sentences=False), dtype=np.float32)


class Piper:
    rate = 22050

    def say(self, text):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            subprocess.run(["uvx", "--from", "piper-tts", "piper", "-m", str(MODELS / "cs_CZ-jirka-medium.onnx"), "-f", f.name], input=text.encode(), check=True, capture_output=True)
            return sf.read(f.name, dtype="float32")[0]


def sentence(engine, words):
    """One sentence → (samples, start time of each page word within it, share of words Whisper recognised)."""
    text = " ".join(spoken(w) for w in words)
    if not re.search(r"[.?]$", text):
        text += "."
    best = None
    for attempt in range(4):
        y, _ = librosa.effects.trim(engine.say(text), top_db=38)
        dur = len(y) / engine.rate
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            sf.write(f.name, y, engine.rate)
            heard = [w for s in mlx_whisper.transcribe(f.name, path_or_hf_repo=WHISPER, language="cs", word_timestamps=True)["segments"] for w in s["words"]]
        times = [None] * len(words)
        for a, b, n in difflib.SequenceMatcher(None, [key(w) for w in words], [key(w["word"]) for w in heard], autojunk=False).get_matching_blocks():
            for k in range(n):
                times[a + k] = heard[b + k]["start"]
        hit = sum(t is not None for t in times) / len(words)
        pace = len(words) / max(dur, .1)
        ok = (hit >= 0.8 or len(words) <= 2) and 0.8 <= pace <= 4.5   # a looped or cut sentence shows in the pace
        if best is None or hit > best[2]:
            best = (y, times, hit, dur)
        if ok:
            break
    else:
        if best[2] < 0.6:
            sys.exit(f"could not get an intelligible reading of: {' '.join(words)!r} (best {best[2]:.0%})")
    y, times, hit, dur = best
    known = [(-1, 0.0)] + [(i, t) for i, t in enumerate(times) if t is not None] + [(len(words), dur)]
    for (i0, t0), (i1, t1) in zip(known, known[1:]):   # unmatched words: spread evenly between matched neighbours
        for i in range(i0 + 1, i1):
            times[i] = t0 + (t1 - t0) * (i - i0) / (i1 - i0)
    return y, [min(max(t, 0), dur) for t in times], hit


def clip(engine, parts, dest):
    """parts = [name, tip, desc] → one audio file; returns {dur, w: start time of every page word} and the weakest sentence's match."""
    name, tip, desc = parts
    lines = [("name", name.split()), ("tip", tip.split())] + [("sentence", s.split()) for s in re.split(r"(?<=[.?])\s+", desc.strip()) if s]
    audio, starts, t, worst = [], [], 0.0, 1.0
    for i, (kind, words) in enumerate(lines):
        y, times, hit = sentence(engine, words)
        worst = min(worst, hit)
        starts += [t + x for x in times]
        gap = PAUSE["end"] if i == len(lines) - 1 else PAUSE[kind]
        audio += [y, np.zeros(int(engine.rate * gap), dtype=np.float32)]
        t += len(y) / engine.rate + gap
    for i in range(1, len(starts)):
        starts[i] = max(starts[i], starts[i - 1])
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        sf.write(f.name, np.concatenate(audio), engine.rate)
        # even loudness across clips, then AAC (plays everywhere, including iPhone)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f.name, "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1",
                        "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(dest)], check=True)
    assert len(starts) == len(name.split()) + len(tip.split()) + len(desc.split()), "word count drifted"
    return {"dur": round(t, 2), "w": [round(x, 2) for x in starts]}, worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--engine", choices=["xtts", "piper"], default="xtts")
    ap.add_argument("--only", nargs="*", help="clips to rebuild, e.g. mitoza-3; the rest keep their audio and timings")
    a = ap.parse_args()
    src = json.loads((HERE / "narration" / f"{a.slug}.json").read_text())
    SAY.update(src["pronounce"])
    out = HERE.parent / "public" / src["slug"] / "audio"
    out.mkdir(parents=True, exist_ok=True)
    timings_file = out / "timings.json"
    data = json.loads(timings_file.read_text()) if a.only and timings_file.exists() else {}
    engine = Xtts() if a.engine == "xtts" else Piper()
    worst = 1.0
    for track, clips in src["tracks"].items():
        data.setdefault(track, [None] * len(clips))
        for i, parts in enumerate(clips):
            if a.only and f"{track}-{i}" not in a.only:
                continue
            data[track][i], hit = clip(engine, parts, out / f"{track}-{i}.m4a")
            worst = min(worst, hit)
            print(f"{track}-{i}: {data[track][i]['dur']:.0f}s, weakest sentence {hit:.0%}", file=sys.stderr, flush=True)
            timings_file.write_text(json.dumps(data, separators=(",", ":")))
    print(f"ok, weakest sentence {worst:.0%}")


if __name__ == "__main__":
    main()
