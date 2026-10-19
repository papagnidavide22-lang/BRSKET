"""Separazione voce / base musicale con un modello MDX-Net (Kim_Vocal_2, formato ONNX).

Uso: separa.py <ingresso.wav> <voce.wav> <base.wav> <modello.onnx>
L'ingresso deve essere WAV PCM 16 bit, 44.1 kHz, stereo (lo prepara FFmpeg).
Stampa "PROGRESS i/n" per l'avanzamento.
"""
import sys
import wave

import numpy as np
import onnxruntime as ort

N_FFT = 7680        # parametri del modello Kim_Vocal_2
HOP = 1024
COMPENSATE = 1.009


def read_wav(path):
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2 and w.getnchannels() == 2, "serve WAV 16 bit stereo"
        data = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    return (data.reshape(-1, 2).T.astype(np.float32) / 32768.0)


def write_wav(path, audio):
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").T.copy()
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(44100)
        w.writeframes(pcm.tobytes())


WINDOW = np.hanning(N_FFT + 1)[:-1].astype(np.float32)  # Hann periodica, come torch


def stft(x):
    """x: [2, T] -> [2, F, frames] complesso (center=True, padding riflesso)."""
    pad = N_FFT // 2
    x = np.pad(x, ((0, 0), (pad, pad)), mode="reflect")
    n_frames = 1 + (x.shape[1] - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    frames = x[:, idx] * WINDOW            # [2, frames, N_FFT]
    return np.fft.rfft(frames, axis=-1).transpose(0, 2, 1)


def istft(spec, length):
    """spec: [2, F, frames] -> [2, length]."""
    frames = np.fft.irfft(spec.transpose(0, 2, 1), n=N_FFT, axis=-1) * WINDOW
    n_frames = frames.shape[1]
    total = N_FFT + HOP * (n_frames - 1)
    out = np.zeros((2, total), dtype=np.float32)
    norm = np.zeros(total, dtype=np.float32)
    for i in range(n_frames):
        s = i * HOP
        out[:, s:s + N_FFT] += frames[:, i]
        norm[s:s + N_FFT] += WINDOW ** 2
    out /= np.maximum(norm, 1e-8)
    pad = N_FFT // 2
    return out[:, pad:pad + length]


def main():
    src, voc_path, inst_path, model_path = sys.argv[1:5]
    mix = read_wav(src)
    n_sample = mix.shape[1]

    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    sess = ort.InferenceSession(model_path, sess_options=opts, providers=ort.get_available_providers())
    inp = sess.get_inputs()[0]
    dim_f, dim_t = int(inp.shape[2]), int(inp.shape[3])

    chunk = HOP * (dim_t - 1)
    trim = N_FFT // 2
    gen = chunk - 2 * trim
    pad = gen - n_sample % gen
    mixture = np.concatenate([np.zeros((2, trim), np.float32), mix, np.zeros((2, pad + trim), np.float32)], axis=1)

    steps = list(range(0, n_sample + pad, gen))
    out = []
    for k, i in enumerate(steps):
        wav = mixture[:, i:i + chunk]
        spec = stft(wav)[:, :dim_f]                                   # [2, dim_f, dim_t]
        x = np.stack([spec.real, spec.imag], axis=1).reshape(1, 4, dim_f, dim_t).astype(np.float32)
        y = sess.run(None, {inp.name: x})[0].reshape(2, 2, dim_f, dim_t)
        pred = y[:, 0] + 1j * y[:, 1]
        full = np.zeros((2, N_FFT // 2 + 1, dim_t), dtype=np.complex64)
        full[:, :dim_f] = pred
        out.append(istft(full, chunk)[:, trim:-trim])
        print(f"PROGRESS {k + 1}/{len(steps)}", flush=True)

    vocals = np.concatenate(out, axis=1)[:, :n_sample] * COMPENSATE
    write_wav(voc_path, vocals)
    write_wav(inst_path, mix - vocals)


if __name__ == "__main__":
    main()
