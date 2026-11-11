#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = "==3.11.*"
# dependencies = ["coqui-tts[codec]", "pocket-tts", "torch", "torchaudio", "six", "mlx-whisper", "soundfile", "numpy", "librosa", "scipy"]
# ///
"""Narration for a lesson: one clip per step plus the start time of every word on the page.

  node voice/dump.mjs <slug> && voice/build.py <slug> [--only <track>-<i> …] [--engine pocket|xtts|piper]

How it is paced. A step is read as its name, its one-line tip, then its description, sentence by
sentence. Each sentence is synthesized on its own, so every one gets its own melody and a real stop
after it, and the pauses are set here: a long one after the name, a shorter one after the tip, a
breath between sentences. (The first version read each step as one block and droned.)

Voice: Pocket TTS with Czech weights (vvolhejn/pocket-tts-czech, CC-BY 4.0, trained on
ParCzech4Speech by ÚFAL, Charles University), speaking in the house voice: a designed voice, never
a recording of a person. The prompt clip is voice/models/house-cs.wav and stays out of the
repository. Two other engines remain selectable: XTTS-v2 has a livelier melody but invents
syllables at the ends of Czech sentences and garbles short names too often to run unattended (and
its licence is non-commercial); Piper is steady and flat.

Checks, per sentence: Whisper listens to it and the result is compared with the script letter by
letter. A reading under 85 %, or one that runs on after the last word, is synthesized again, up to
five times; the best one is kept, and the build fails if none reaches 75 %. Word times come from
the same listening; a word heard differently takes a time between its neighbours. The contract
test fails when the lesson's text changes after this ran.
"""
import argparse, difflib, json, os, pathlib, re, subprocess, sys, tempfile, unicodedata
import numpy as np, soundfile as sf, librosa, mlx_whisper

HERE = pathlib.Path(__file__).parent
# models and the voice reference live in the main checkout even when this runs from a git worktree
MODELS = pathlib.Path(os.environ.get("MEDICINA_VOICE_MODELS", HERE / "models"))
PAUSE = {"name": 0.85, "tip": 0.7, "sentence": 0.42, "end": 0.25}   # seconds of silence after each kind of line
TEMPO = 0.92   # the voice speaks briskly (about five syllables a second); slowed a little, pitch kept, for someone who is learning
SAY = {"I": "jedna", "II": "dvě", "III": "tři", "DNA": "dé en á", "RNA": "er en á", "mRNA": "em er en á", "tRNA": "té er en á",
       "rRNA": "er er en á", "ATP": "á té pé", "ADP": "á dé pé", "pH": "pé há", "CO₂": "cé ó dvě", "O₂": "ó dvě", "H₂O": "há dvě ó"}
WHISPER = "mlx-community/whisper-large-v3-turbo"


def spoken(word):
    core = word.strip(".,;:!?()")
    return word.replace(core, SAY[core]) if core in SAY else word


def key(w):
    w = unicodedata.normalize("NFD", w.lower().translate(str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if unicodedata.category(c) != "Mn"))


class Xtts:
    rate = 24000

    def __init__(self):
        os.environ.setdefault("COQUI_TOS_AGREED", "1")   # Coqui CPML: non-commercial use only
        from TTS.api import TTS
        self.tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        self.ref = str(MODELS / "house.wav")
        assert os.path.exists(self.ref), f"voice reference missing: {self.ref}"

    def say(self, text):
        return np.asarray(self.tts.tts(text=text, speaker_wav=self.ref, language="cs", split_sentences=False), dtype=np.float32)


class Pocket:
    """Pocket TTS with Czech weights (vvolhejn/pocket-tts-czech, CC-BY 4.0, trained on ParCzech4Speech by ÚFAL, Charles
    University). The voice prompt is the house voice speaking Czech (voice/models/house-cs.wav)."""

    def __init__(self):
        from pocket_tts import TTSModel
        self.model = TTSModel.load_model(config="hf://vvolhejn/pocket-tts-czech/czech.yaml@7c1fbd0acba765617749dd17f3dbddc2be791cc7")
        self.rate = self.model.sample_rate
        ref = str(MODELS / "house-cs.wav")
        assert os.path.exists(ref), f"voice prompt missing: {ref}"
        self.voice = self.model.get_state_for_audio_prompt(ref)

    def say(self, text):
        return self.model.generate_audio(self.voice, text).numpy().astype(np.float32)


class Piper:
    rate = 22050

    def say(self, text):
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            subprocess.run(["uvx", "--from", "piper-tts", "piper", "-m", str(MODELS / "cs_CZ-jirka-medium.onnx"), "-f", f.name], input=text.encode(), check=True, capture_output=True)
            return sf.read(f.name, dtype="float32")[0]


DIGITS = {"0": "nula", "1": "jedna", "2": "dve", "3": "tri", "4": "ctyri", "5": "pet", "6": "sest", "7": "sedm", "8": "osm", "9": "devet"}


def letters(w):
    """A word as bare letters, digits spelled out, so "Pro fáze 1." and "Profáze jedna" compare equal."""
    return "".join(DIGITS.get(c, c) for c in key(w))


def sentence(engine, words, stop_after=None):
    """One sentence → (samples, start time of each page word within it, share of the spoken letters Whisper heard).

    The comparison is letter by letter, not word by word: Whisper splits, joins and respells words
    ("Pro fáze 1", "G2") while hearing them correctly.
    """
    said = [spoken(w) for w in words]
    # stop_after: index of a word that ends a sentence without the page showing a full stop (the step's name)
    text = " ".join(w + "." if i == stop_after and not re.search(r"[.?]$", w) else w for i, w in enumerate(said))
    if not re.search(r"[.?]$", text):
        text += "."
    want = [(c, i) for i, w in enumerate(said) for c in letters(w)]          # (letter, page word it belongs to)
    alias = {key(w): letters(sp) for w, sp in zip(words, said) if sp != w}   # a symbol heard as a symbol stands for its spoken form
    best = None
    for attempt in range(5):
        y, _ = librosa.effects.trim(engine.say(text), top_db=38)
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            sf.write(f.name, y, engine.rate)
            heard = [w for s in mlx_whisper.transcribe(f.name, path_or_hf_repo=WHISPER, language="cs", word_timestamps=True)["segments"] for w in s["words"]]
        got = [(c, j) for j, w in enumerate(heard) for c in alias.get(key(w["word"]), letters(w["word"]))]   # (letter, heard word)
        times, hits, last = [None] * len(words), 0, -1
        for a, b, n in difflib.SequenceMatcher(None, [c for c, _ in want], [c for c, _ in got], autojunk=False).get_matching_blocks():
            for k in range(n):
                i = want[a + k][1]
                if times[i] is None:
                    times[i] = heard[got[b + k][1]]["start"]
            if n:
                hits, last = hits + n, b + n - 1
        hit = hits / max(len(want), 1)
        # Letters voiced after the script's last one are the model running on (XTTS does this): cut them off.
        extra = len(got) - 1 - last
        if extra >= 4 and last >= 0 and times[-1] is not None:
            y, extra = y[: int((heard[got[last][1]]["end"] + 0.12) * engine.rate)], 0
        dur = len(y) / engine.rate
        pace = len(said) / max(dur, .1)
        ok = hit >= 0.85 and extra < 4 and 0.6 <= pace <= 5   # a looped or cut sentence shows in the pace
        score = hit - 0.05 * min(extra, 8)
        if best is None or score > best[4]:
            best = (y, times, hit, dur, score)
        if ok:
            break
        print(f"    try {attempt + 1}: {hit:.0%}, {extra} letters extra  wanted {text!r}  heard {' '.join(w['word'].strip() for w in heard)!r}", file=sys.stderr, flush=True)
    else:
        if best[4] < 0.75:
            sys.exit(f"could not get an intelligible reading of: {text!r} (best {best[2]:.0%})")
    y, times, hit, dur, _ = best
    known = [(-1, 0.0)] + [(i, t) for i, t in enumerate(times) if t is not None] + [(len(words), dur)]
    for (i0, t0), (i1, t1) in zip(known, known[1:]):   # unmatched words: spread evenly between matched neighbours
        for i in range(i0 + 1, i1):
            times[i] = t0 + (t1 - t0) * (i - i0) / (i1 - i0)
    return y, [min(max(t, 0), dur) for t in times], hit


def clip(engine, parts, dest):
    """parts = [name, tip, desc] → one audio file; returns {dur, w: start time of every page word} and the weakest line's match."""
    name, tip, desc = parts
    audio, starts, t, worst = [], [], 0.0, 1.0

    def put(y, times, gap):
        nonlocal t
        starts.extend(t + x for x in times)
        audio.extend([y, np.zeros(int(engine.rate * gap), dtype=np.float32)])
        t += len(y) / engine.rate + gap

    # The name is one or two words, too little for the voice or the listener-check to be reliable alone,
    # so it is spoken together with the tip and the long pause is opened up between them afterwards.
    n = len(name.split())
    y, times, worst = sentence(engine, name.split() + tip.split(), stop_after=n - 1)
    cut = int(max(times[n] - 0.06, 0) * engine.rate)
    head, _ = librosa.effects.trim(y[:cut], top_db=38) if cut > 0 else (y[:0], None)
    put(head, times[:n], PAUSE["name"])
    put(y[cut:], [max(x - cut / engine.rate, 0) for x in times[n:]], PAUSE["tip"])
    lines = [s.split() for s in re.split(r"(?<=[.?])\s+", desc.strip()) if s]
    for i, words in enumerate(lines):
        y, times, hit = sentence(engine, words)
        worst = min(worst, hit)
        put(y, times, PAUSE["end"] if i == len(lines) - 1 else PAUSE["sentence"])
    for i in range(1, len(starts)):
        starts[i] = max(starts[i], starts[i - 1])
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        sf.write(f.name, np.concatenate(audio), engine.rate)
        # even loudness across clips, then AAC (plays everywhere, including iPhone)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f.name, "-af", f"atempo={TEMPO},loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", "44100", "-ac", "1",
                        "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(dest)], check=True)
    assert len(starts) == len(name.split()) + len(tip.split()) + len(desc.split()), "word count drifted"
    return {"dur": round(t / TEMPO, 2), "w": [round(x / TEMPO, 2) for x in starts]}, worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--engine", choices=["pocket", "xtts", "piper"], default="pocket")
    ap.add_argument("--only", nargs="*", help="clips to rebuild, e.g. mitoza-3; the rest keep their audio and timings")
    a = ap.parse_args()
    src = json.loads((HERE / "narration" / f"{a.slug}.json").read_text())
    SAY.update(src["pronounce"])
    out = HERE.parent / "public" / src["slug"] / "audio"
    out.mkdir(parents=True, exist_ok=True)
    timings_file = out / "timings.json"
    data = json.loads(timings_file.read_text()) if a.only and timings_file.exists() else {}
    engine = {"xtts": Xtts, "pocket": Pocket, "piper": Piper}[a.engine]()
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
