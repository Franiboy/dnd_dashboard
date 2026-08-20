from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import traceback
import wave
from difflib import SequenceMatcher

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


class DecodeProgress:
    def __init__(self) -> None:
        self.total = 0
        self.completed = 0

    def reset(self, total: int) -> None:
        self.total = max(0, total)
        self.completed = 0

    def report_position(self, current: int) -> None:
        if self.total <= 0:
            return
        current = min(self.total, max(self.completed, current))
        self.completed = current
        emit({"type": "progress", "current": current, "total": self.total})


_progress = DecodeProgress()


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


def _normalize_text(text: str) -> str:
    return re.sub(r"[^a-zäöüß0-9]", "", text.lower())


def _tokenize(text: str) -> list[str]:
    return [word for word in re.sub(r"[^a-zäöüß0-9 ]", " ", text.lower()).split()]


_WORD_CORRECTIONS = (("pott", "bot"),)


def _apply_corrections(text: str) -> str:
    for wrong, right in _WORD_CORRECTIONS:
        pattern = re.compile(rf"\b{wrong}\b", re.IGNORECASE)
        text = pattern.sub(lambda m: right.capitalize() if m.group(0)[:1].isupper() else right, text)
    return text


def _is_prompt_echo(text: str, initial_prompt: str) -> bool:
    seg_words = _tokenize(text)
    prompt_words = _tokenize(initial_prompt)
    if not seg_words or not prompt_words:
        return False

    matcher = SequenceMatcher(None, seg_words, prompt_words, autojunk=False)
    matched = sum(size for _, _, size in matcher.get_matching_blocks())
    min_matched = max(5, int(len(seg_words) * 0.5))
    return matched >= min_matched and matched >= len(seg_words) * 0.5


def _is_likely_hallucination(seg: dict, no_speech_prob_threshold: float, initial_prompt: str | None) -> bool:
    text = str(seg.get("text", "")).strip()
    if not text:
        return True

    if initial_prompt and _is_prompt_echo(text, initial_prompt):
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
    """Transcribe one speaker WAV with faster-whisper + Silero VAD.

    faster-whisper skips non-speech regions internally (Silero VAD) while
    keeping the original timeline for every segment, so long pauses where the
    speaker was silent are neither transcribed nor cut into tiny chunks. The
    VAD is configured to merge short pauses (< vad_min_silence) into the
    surrounding speech, preserving model context.
    """
    errors: list[str] = []
    duration = _get_audio_duration(audio_path)
    if duration <= 0:
        return [], [f"No audio in {os.path.basename(audio_path)}"]

    _progress.reset(int(duration * _FRAMES_PER_SECOND))

    vad_parameters = {
        "min_silence_duration_ms": max(100, int(args.vad_min_silence * 1000)),
        "min_speech_duration_ms": max(50, int(args.vad_min_speech * 1000)),
        "speech_pad_ms": 400,
    }

    language = args.language
    if language and language.lower() in ("auto", "detect"):
        language = None

    file_segments: list[dict] = []
    try:
        segments, _info = model.transcribe(
            audio_path,
            language=language,
            temperature=0.0,
            beam_size=5,
            best_of=5,
            patience=1.0,
            compression_ratio_threshold=1.8,
            no_speech_threshold=0.6,
            no_repeat_ngram_size=3,
            condition_on_previous_text=args.condition_on_previous,
            vad_filter=True,
            vad_parameters=vad_parameters,
            initial_prompt=args.initial_prompt or None,
            word_timestamps=False,
        )
        for seg in segments:
            start = float(getattr(seg, "start", 0.0) or 0.0)
            end = float(getattr(seg, "end", start) or start)
            text = str(getattr(seg, "text", "") or "").strip()
            entry = {
                "start": start,
                "end": end,
                "text": text,
                "speaker": display_name,
                "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
                "avg_logprob": float(getattr(seg, "avg_logprob", 0.0) or 0.0),
            }
            _progress.report_position(int(end * _FRAMES_PER_SECOND))

            if _is_likely_hallucination(entry, args.filter_no_speech_prob, args.initial_prompt):
                continue
            file_segments.append(entry)
    except Exception as e:
        errors.append(f"{display_name}: faster-whisper transcription failed: {e}")
        return [], errors

    file_segments.sort(key=lambda s: s["start"])
    return file_segments, errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="de")
    parser.add_argument("--fp16", type=lambda x: x.lower() == "true", default=False, help="deprecated; use --compute-type")
    parser.add_argument("--compute-type", default="int8", help="int8, int8_float16, float16 or float32")
    parser.add_argument("--condition-on-previous", type=lambda x: x.lower() != "false", default=True)
    parser.add_argument("--trim-start", type=float, default=0)
    parser.add_argument("--trim-end", type=float, default=None)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--files", required=True, help="JSON array of {id, userId, wavPath, displayName}")
    parser.add_argument("--completed-files", default="[]", help="JSON array of already completed {id, userId, wavPath, displayName, transcriptPath}")
    parser.add_argument("--initial-prompt", default=None)
    parser.add_argument("--noise-reduce", type=lambda x: x.lower() == "true", default=True)
    parser.add_argument("--vad-noise-db", type=float, default=-40.0, help="deprecated; kept for CLI compatibility")
    parser.add_argument("--vad-min-silence", type=float, default=2.0, help="seconds of silence that split speech regions")
    parser.add_argument("--vad-min-speech", type=float, default=0.5, help="minimum speech region duration in seconds")
    parser.add_argument("--vad-gap-merge", type=float, default=0.0, help="deprecated; use --vad-min-silence")
    parser.add_argument("--filter-no-speech-prob", type=float, default=0.9)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        emit({"type": "error", "error": f"Failed to load faster-whisper: {e}. Run: python3 -m pip install --user faster-whisper"})
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
        model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type)
    except Exception as e:
        emit({"type": "error", "error": f"Failed to load faster-whisper model: {e}"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    emit({"type": "progress", "message": f"Loaded {args.model} (compute_type={args.compute_type})"})

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

            for seg in file_segments:
                if seg["end"] <= trim_start or seg["start"] >= trim_end:
                    continue
                seg["start"] = max(seg["start"], trim_start)
                seg["end"] = min(seg["end"], trim_end)
                all_segments.append(seg)

            speaker_lines = [
                f"[{format_timestamp(seg['start'])}] {_apply_corrections(seg['text']).strip()}"
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
            f"[{format_timestamp(seg['start'])}] {seg['speaker']}: {_apply_corrections(seg['text']).strip()}"
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
