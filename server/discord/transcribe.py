from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import traceback
import wave

def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def format_timestamp(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


_FRAMES_PER_SECOND = 100
_N_FRAMES = 1500


class DecodeProgress:
    def __init__(self) -> None:
        self.count = 0
        self.total = 0

    def reset(self, total: int) -> None:
        self.count = 0
        self.total = max(0, total)

    def tick(self) -> None:
        self.count += 1
        if self.total > 0:
            current = min(self.total, self.count * _N_FRAMES)
            emit({"type": "progress", "current": current, "total": self.total})


_progress = DecodeProgress()


def patch_tqdm() -> None:
    try:
        import tqdm as tqdm_module

        patched = set()

        def wrap_update(cls, original):
            if id(cls) in patched:
                return
            patched.add(id(cls))

            def update(self, n: int = 1) -> None:
                original(self, n)
                total = getattr(self, "total", None)
                if total:
                    emit({"type": "progress", "current": getattr(self, "n", 0), "total": total})

            cls.update = update

        classes = [tqdm_module.tqdm]
        if hasattr(tqdm_module, "std"):
            classes.append(tqdm_module.std.tqdm)
        if hasattr(tqdm_module, "auto"):
            classes.append(tqdm_module.auto.tqdm)

        for cls in classes:
            if cls is not None and hasattr(cls, "update"):
                wrap_update(cls, cls.update)
    except Exception:
        pass


def patch_model_decode(model) -> None:
    original_decode = model.decode

    def patched_decode(segment, *args, **kwargs):
        _progress.tick()
        return original_decode(segment, *args, **kwargs)

    model.decode = patched_decode


def preprocess_audio(input_path: str) -> str:
    normalized = input_path.replace(".wav", "_norm.wav")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-af", "highpass=f=80, lowpass=f=8000, afftdn=nf=-25, volume=2.0",
                "-ar", "16000", "-ac", "1", "-sample_fmt", "s16",
                normalized,
            ],
            capture_output=True, check=True,
        )
        emit({"type": "progress", "message": f"Audio preprocessed: {os.path.basename(input_path)}"})
        return normalized
    except subprocess.CalledProcessError:
        emit({"type": "progress", "message": "Audio preprocessing failed, using original"})
        return input_path


def _get_segments_path(transcript_path: str) -> str:
    return transcript_path.replace(".txt", ".segments.json")


def _parse_timestamp_to_seconds(ts: str) -> float | None:
    parts = ts.split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return None


def _parse_transcript_txt(transcript_path: str, display_name: str, trim_start: float, trim_end: float) -> list[dict] | None:
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            lines = [line.rstrip("\n") for line in f if line.strip()]
    except Exception:
        return None

    parsed: list[tuple[float, str]] = []
    for line in lines:
        match = re.match(r"^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$", line)
        if not match:
            continue
        ts, text = match.groups()
        seconds = _parse_timestamp_to_seconds(ts)
        if seconds is None:
            continue
        parsed.append((seconds, text))

    if not parsed:
        return None

    segments = []
    for i, (start, text) in enumerate(parsed):
        if start < trim_start or start >= trim_end:
            continue
        next_start = parsed[i + 1][0] if i + 1 < len(parsed) else start + 2.0
        end = min(next_start, trim_end)
        segments.append({
            "start": max(start, trim_start),
            "end": end,
            "text": text,
            "speaker": display_name,
        })
    return segments if segments else None


def _load_completed_segments(transcript_path: str, display_name: str, trim_start: float, trim_end: float) -> list[dict] | None:
    segments_path = _get_segments_path(transcript_path)
    try:
        if os.path.exists(segments_path) and os.path.getsize(segments_path) > 0:
            with open(segments_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and data:
                segments = []
                for seg in data:
                    if not isinstance(seg, dict):
                        continue
                    start = float(seg.get("start", 0))
                    end = float(seg.get("end", 0))
                    text = str(seg.get("text", ""))
                    speaker = str(seg.get("speaker", display_name))
                    if end <= trim_start or start >= trim_end:
                        continue
                    segments.append({
                        "start": max(start, trim_start),
                        "end": min(end, trim_end),
                        "text": text,
                        "speaker": display_name if display_name else speaker,
                    })
                if segments:
                    return segments
    except Exception:
        pass

    try:
        if os.path.exists(transcript_path) and os.path.getsize(transcript_path) > 0:
            return _parse_transcript_txt(transcript_path, display_name, trim_start, trim_end)
    except Exception:
        pass

    return None


def _write_segments(transcript_path: str, segments: list[dict]) -> None:
    try:
        segments_path = _get_segments_path(transcript_path)
        with open(segments_path, "w", encoding="utf-8") as f:
            json.dump(segments, f, ensure_ascii=False)
    except Exception:
        pass


def _get_audio_duration(wav_path: str) -> float:
    try:
        with wave.open(wav_path, "rb") as wf:
            return wf.getnframes() / max(1, wf.getframerate())
    except Exception:
        return 0.0


def _detect_silence(
    input_path: str,
    noise_db: float,
    min_duration: float,
    errors: list[str],
) -> list[tuple[float, float]] | None:
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", input_path,
                "-af", f"silencedetect=noise={noise_db}dB:d={min_duration}",
                "-f", "null", "-",
            ],
            capture_output=True, text=True, check=False,
        )
        stderr = result.stderr or ""

        if result.returncode != 0:
            errors.append(f"VAD (silencedetect) failed for {os.path.basename(input_path)}: {stderr.strip()[:500]}")
            return None

        starts = [float(m) for m in re.findall(r"silence_start:\s*([\d.]+)", stderr)]
        ends = [float(m) for m in re.findall(r"silence_end:\s*([\d.]+)", stderr)]
        duration = _get_audio_duration(input_path)

        intervals: list[tuple[float, float]] = []
        for i, start in enumerate(starts):
            end = ends[i] if i < len(ends) else duration
            if end > start:
                intervals.append((start, end))
        return intervals
    except Exception as e:
        errors.append(f"VAD (silencedetect) error for {os.path.basename(input_path)}: {e}")
        return None


def _compute_speech_intervals(
    input_path: str,
    silence_intervals: list[tuple[float, float]] | None,
    min_speech_duration: float,
    gap_merge: float,
) -> list[tuple[float, float]]:
    duration = _get_audio_duration(input_path)
    if duration <= 0:
        return []

    if silence_intervals is None or not silence_intervals:
        return [(0.0, duration)] if duration >= min_speech_duration else []

    silence = sorted(silence_intervals)
    speech: list[tuple[float, float]] = []
    cursor = 0.0
    for s, e in silence:
        if s > cursor:
            speech.append((cursor, min(s, duration)))
        cursor = max(cursor, e)
    if cursor < duration:
        speech.append((cursor, duration))

    if gap_merge > 0 and len(speech) > 1:
        merged: list[tuple[float, float]] = [speech[0]]
        for s, e in speech[1:]:
            prev_s, prev_e = merged[-1]
            if s - prev_e <= gap_merge:
                merged[-1] = (prev_s, e)
            else:
                merged.append((s, e))
        speech = merged

    return [(s, e) for s, e in speech if (e - s) >= min_speech_duration]


def _extract_audio_segment(input_path: str, output_path: str, start: float, end: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start), "-to", str(end),
            "-ar", "16000", "-ac", "1", "-sample_fmt", "s16",
            output_path,
        ],
        capture_output=True, check=True,
    )


def _is_likely_hallucination(seg: dict, no_speech_prob_threshold: float) -> bool:
    text = str(seg.get("text", "")).strip()
    if not text:
        return True

    no_speech_prob = float(seg.get("no_speech_prob", 0.0))
    avg_logprob = float(seg.get("avg_logprob", 0.0))
    word_count = len(text.split())

    # Very short, low-confidence segments that Whisper invented during silence.
    if word_count <= 2 and no_speech_prob > no_speech_prob_threshold:
        return True
    if word_count <= 2 and avg_logprob < -1.0:
        return True

    return False


def _transcribe_file(
    model,
    audio_path: str,
    display_name: str,
    args: argparse.Namespace,
) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    silence_intervals = _detect_silence(
        audio_path,
        noise_db=args.vad_noise_db,
        min_duration=args.vad_min_silence,
        errors=errors,
    )
    speech_intervals = _compute_speech_intervals(
        audio_path,
        silence_intervals,
        min_speech_duration=args.vad_min_speech,
        gap_merge=args.vad_gap_merge,
    )

    if not speech_intervals:
        return [], errors

    total_frames = sum(int((end - start) * _FRAMES_PER_SECOND) for start, end in speech_intervals)
    _progress.reset(total_frames)

    file_segments: list[dict] = []
    duration = _get_audio_duration(audio_path)

    # If the whole file is one continuous speech segment (e.g. VAD disabled or
    # ffmpeg unavailable), transcribe it directly without re-encoding.
    direct_transcribe = (
        len(speech_intervals) == 1
        and abs(speech_intervals[0][0] - 0.0) < 0.01
        and abs(speech_intervals[0][1] - duration) < 0.01
    )

    with tempfile.TemporaryDirectory(prefix="whisper_chunks_") as tmpdir:
        for i, (start, end) in enumerate(speech_intervals):
            chunk_path = os.path.join(tmpdir, f"chunk_{i:04d}.wav")
            try:
                if direct_transcribe:
                    chunk_path = audio_path
                else:
                    _extract_audio_segment(audio_path, chunk_path, start, end)
            except FileNotFoundError as e:
                errors.append(f"Chunk {i} for {display_name}: ffmpeg not found ({e})")
                continue
            except subprocess.CalledProcessError as e:
                stderr = e.stderr.decode("utf-8", errors="ignore") if isinstance(e.stderr, bytes) else str(e.stderr or "")
                errors.append(f"Chunk {i} for {display_name}: ffmpeg extraction failed: {stderr.strip()[:500]}")
                continue

            try:
                result = model.transcribe(
                    chunk_path,
                    language=args.language,
                    fp16=args.fp16,
                    verbose=False,
                    temperature=0.0,
                    compression_ratio_threshold=1.8,
                    logprob_threshold=-0.9,
                    no_speech_threshold=0.6,
                    condition_on_previous_text=False,
                    initial_prompt=args.initial_prompt,
                    beam_size=5,
                    best_of=5,
                    patience=1.0,
                )

                for seg in result.get("segments", []):
                    rel_start = float(seg.get("start", 0.0))
                    rel_end = float(seg.get("end", 0.0))
                    seg["start"] = start + rel_start
                    seg["end"] = min(end, start + rel_end)
                    seg["speaker"] = display_name

                    if _is_likely_hallucination(seg, args.filter_no_speech_prob):
                        continue

                    file_segments.append(seg)
            except Exception as e:
                errors.append(f"Chunk {i} for {display_name}: Whisper transcription failed: {e}")
                continue

    file_segments.sort(key=lambda s: float(s["start"]))
    return file_segments, errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="de")
    parser.add_argument("--fp16", type=lambda x: x.lower() == "true", default=False)
    parser.add_argument("--trim-start", type=float, default=0)
    parser.add_argument("--trim-end", type=float, default=None)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--files", required=True, help="JSON array of {id, userId, wavPath, displayName}")
    parser.add_argument("--completed-files", default="[]", help="JSON array of already completed {id, userId, wavPath, displayName, transcriptPath}")
    parser.add_argument("--initial-prompt", default=None)
    parser.add_argument("--noise-reduce", type=lambda x: x.lower() == "true", default=True)
    parser.add_argument("--vad-noise-db", type=float, default=-40.0)
    parser.add_argument("--vad-min-silence", type=float, default=0.5)
    parser.add_argument("--vad-min-speech", type=float, default=0.3)
    parser.add_argument("--vad-gap-merge", type=float, default=0.0)
    parser.add_argument("--filter-no-speech-prob", type=float, default=0.9)
    args = parser.parse_args()

    patch_tqdm()

    try:
        import whisper
    except Exception as e:
        emit({"type": "error", "error": f"Failed to load Whisper: {e}"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    try:
        files = json.loads(args.files)
    except json.JSONDecodeError as e:
        emit({"type": "error", "error": f"Invalid files JSON: {e}"})
        sys.exit(1)

    try:
        completed_files_arg = json.loads(args.completed_files) if args.completed_files else []
    except json.JSONDecodeError as e:
        emit({"type": "error", "error": f"Invalid completed files JSON: {e}"})
        sys.exit(1)

    completed_by_id = {str(item.get("id")): item for item in completed_files_arg if item.get("id") is not None}

    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)

    trim_start = args.trim_start
    trim_end = args.trim_end if args.trim_end is not None else float("inf")

    try:
        model = whisper.load_model(args.model)
    except Exception as e:
        emit({"type": "error", "error": f"Failed to load model: {e}"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    patch_model_decode(model)

    all_segments = []
    errors = []
    completed_files = []

    for i, file_info in enumerate(files):
        file_id = file_info.get("id")
        wav_path = file_info.get("wavPath")
        user_id = file_info.get("userId")
        display_name = file_info.get("displayName", f"Speaker {i + 1}")

        emit({"type": "file_start", "index": i, "total": len(files), "name": display_name})

        completed_info = completed_by_id.get(str(file_id))
        loaded_segments = None
        if completed_info and completed_info.get("transcriptPath"):
            loaded_segments = _load_completed_segments(
                completed_info["transcriptPath"], display_name, trim_start, trim_end
            )

        if loaded_segments:
            transcript_path = completed_info["transcriptPath"]
            all_segments.extend(loaded_segments)
            completed_files.append({"id": file_id, "userId": user_id, "transcriptPath": transcript_path})
            emit({"type": "file_complete", "index": i, "id": file_id, "userId": user_id, "transcriptPath": transcript_path})
            continue

        audio_path = wav_path
        if args.noise_reduce:
            audio_path = preprocess_audio(wav_path)

        try:
            file_segments, file_errors = _transcribe_file(model, audio_path, display_name, args)
            for error in file_errors:
                errors.append(f"{display_name}: {error}")
                emit({"type": "file_error", "index": i, "error": error})

            if not file_segments:
                # Fall back to a single empty transcript file so the file is marked as completed.
                file_segments = []

            for seg in file_segments:
                if seg["end"] <= trim_start or seg["start"] >= trim_end:
                    continue
                seg["start"] = max(seg["start"], trim_start)
                seg["end"] = min(seg["end"], trim_end)
                all_segments.append(seg)

            speaker_lines = [
                f"[{format_timestamp(seg['start'])}] {seg['text'].strip()}"
                for seg in file_segments
            ]
            transcript_path = os.path.join(output_dir, f"speaker-{user_id}.txt")
            with open(transcript_path, "w", encoding="utf-8") as f:
                f.write("\n".join(speaker_lines))

            _write_segments(transcript_path, file_segments)

            completed_files.append({"id": file_id, "userId": user_id, "transcriptPath": transcript_path})
            emit({"type": "file_complete", "index": i, "id": file_id, "userId": user_id, "transcriptPath": transcript_path})
        except Exception as e:
            message = str(e)
            errors.append(f"{display_name}: {message}")
            emit({"type": "file_error", "index": i, "error": message})

    if all_segments:
        all_segments.sort(key=lambda s: s["start"])
        transcript_lines = [
            f"[{format_timestamp(seg['start'])}] {seg['speaker']}: {seg['text'].strip()}"
            for seg in all_segments
        ]
        transcript = "\n".join(transcript_lines)
        transcript_path = os.path.join(output_dir, "transcript.txt")
        with open(transcript_path, "w", encoding="utf-8") as f:
            f.write(transcript)

        emit(
            {
                "type": "complete",
                "transcript": transcript,
                "transcriptPath": transcript_path,
                "files": completed_files,
                "errors": errors,
            }
        )
    else:
        emit(
            {
                "type": "error",
                "error": "; ".join(errors) if errors else "Transkription lieferte keine Ergebnisse",
            }
        )


if __name__ == "__main__":
    main()
