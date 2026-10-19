"""Separazione in strumenti con Demucs htdemucs_6s (Meta): voce, batteria, basso, chitarra, piano, altro.

Uso: separa_strumenti.py <ingresso.wav> <cartella_uscita> [tracce...]
Tracce: vocals drums bass guitar piano other instrumental (strumentale = tutto tranne la voce).
Senza tracce le scrive tutte.
L'ingresso deve essere WAV PCM 16 bit, 44.1 kHz, stereo (lo prepara FFmpeg).
Scrive <cartella>/<strumento>.wav e stampa "PROGRESS x" (0-100) per l'avanzamento.
"""
import os
import sys
import wave

import numpy as np
import torch
import demucs.apply as dapply
from demucs.pretrained import get_model


def read_wav(path):
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2 and w.getnchannels() == 2, "serve WAV 16 bit stereo"
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return data.reshape(-1, 2).T.astype(np.float32) / 32768.0


def write_wav(path, audio):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").T.copy()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(pcm.tobytes())


class Progress:
    """Sostituisce la barra tqdm di Demucs con righe leggibili dal server."""

    def __init__(self, iterable, *args, **kwargs):
        self.items = list(iterable)

    def __iter__(self):
        n = len(self.items) or 1
        for i, item in enumerate(self.items):
            yield item
            print(f"PROGRESS {round((i + 1) / n * 100)}", flush=True)


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    wanted = set(sys.argv[3:]) or {"vocals", "drums", "bass", "guitar", "piano", "other", "instrumental"}
    os.makedirs(out_dir, exist_ok=True)
    torch.set_num_threads(max(1, os.cpu_count() or 1))

    print("STAGE modello", flush=True)
    model = get_model("htdemucs_6s")
    model.eval()

    mix = torch.from_numpy(read_wav(src))
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (mix - mean) / std

    dapply.tqdm.tqdm = Progress  # avanzamento leggibile
    print("STAGE separazione", flush=True)
    with torch.no_grad():
        stems = dapply.apply_model(model, x[None], device="cpu", shifts=1, split=True, overlap=0.25, progress=True)[0]
    stems = stems * std + mean

    instrumental = None
    for name, audio in zip(model.sources, stems):
        if name != "vocals":
            instrumental = audio if instrumental is None else instrumental + audio
        if name in wanted:
            write_wav(os.path.join(out_dir, f"{name}.wav"), audio.numpy())
            print(f"STEM {name}", flush=True)
    if "instrumental" in wanted and instrumental is not None:
        write_wav(os.path.join(out_dir, "instrumental.wav"), instrumental.numpy())
        print("STEM instrumental", flush=True)


if __name__ == "__main__":
    main()
