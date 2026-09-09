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
_SAMPLE_RATE = 16000
# Rolling conversation context fed to the model as initial_prompt for each
# speech region, so the dialogue (who answered whom, the running topic) stays
# available across speakers instead of transcribing every person in isolation.
_MAX_CONTEXT_CHARS = 400


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


_FILENAME_UNSAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]")


def _safe_filename_component(value: object) -> str:
    """Reduce an external value (e.g. a Discord userId) to a safe filename component."""
    cleaned = _FILENAME_UNSAFE_CHARS.sub("_", str(value)).strip(".")
    return cleaned or "unknown"


def _contained_path(output_dir: str, filename: str) -> str:
    """Join filename under output_dir and refuse any escape from that directory."""
    base = os.path.realpath(output_dir)
    target = os.path.realpath(os.path.join(base, filename))
    if os.path.commonpath([base, target]) != base:
        raise ValueError(f"Refusing to write outside the output directory: {filename}")
    return target


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


def _write_segments(output_dir: str, transcript_filename: str, segments: list[dict]) -> None:
    try:
        stem = transcript_filename[: -len(".txt")] if transcript_filename.endswith(".txt") else transcript_filename
        with open(_contained_path(output_dir, f"{stem}.segments.json"), "w", encoding="utf-8") as f:
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


def _is_amp_chain_hallucination(text: str) -> bool:
    # Hallucinated ampersand chains: "cloudsen&goblin1 & cloudsen2&cloudsen2 & ..."
    # Legitimate intra-text "&" is rare (mostly "Nils & Cloudsen Ja.").
    # Chains with >=2 ampersands and fragmented short parts are almost always invented.
    if text.count("&") >= 2 and re.search(r"\w{2,}&\w{2,}", text):
        # Compact pairs within a longer chain are characteristic of the artifact.
        return True
    if text.count("&") < 2:
        return False
    # Split on & and check fragment structure
    parts = [p.strip() for p in re.split(r"\s*&\s*", text) if p.strip()]
    if len(parts) >= 3 and all(len(p) >= 2 and len(p.split()) <= 2 for p in parts):
        return True
    # Heuristic: repeated "cloudsen" variations with digits -> invented suffix chain
    lower = text.lower()
    if lower.count("cloudsen") >= 2 and "&" in text:
        return True
    return False


def _is_likely_hallucination(seg: dict, no_speech_prob_threshold: float, initial_prompt: str | None) -> bool:
    text = str(seg.get("text", "")).strip()
    if not text:
        return True

    if initial_prompt and _is_prompt_echo(text, initial_prompt):
        return True

    if _is_amp_chain_hallucination(text):
        return True

    no_speech_prob = float(seg.get("no_speech_prob", 0.0))
    avg_logprob = float(seg.get("avg_logprob", 0.0))
    word_count = len(text.split())

    # Very short, low-confidence segments that Whisper invented during silence.
    if word_count <= 2 and no_speech_prob > no_speech_prob_threshold:
        return True
    if word_count <= 2 and avg_logprob < -1.0:
        return True
    # Short ampersand fragments with mediocre confidence are also hallucinations
    if word_count <= 4 and "&" in text and avg_logprob < -0.8:
        return True
    if word_count <= 4 and "&" in text and no_speech_prob > 0.6:
        return True

    return False


def _vad_speech_intervals(audio, args: argparse.Namespace) -> list[tuple[int, int]]:
    """Silero VAD speech intervals in samples at _SAMPLE_RATE."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    vad_options = VadOptions(
        threshold=0.5,
        min_speech_duration_ms=max(50, int(args.vad_min_speech * 1000)),
        min_silence_duration_ms=max(100, int(args.vad_min_silence * 1000)),
        speech_pad_ms=400,
    )
    result = get_speech_timestamps(audio, vad_options=vad_options, sampling_rate=_SAMPLE_RATE)
    return [(int(entry["start"]), int(entry["end"])) for entry in result if entry.get("end", 0) > entry.get("start", 0)]


def _transcribe_chunk(
    model,
    chunk_audio,
    chunk_offset_seconds: float,
    display_name: str,
    args: argparse.Namespace,
    initial_prompt: str | None,
) -> list[dict]:
    """Transcribe one audio chunk; returns segments re-mapped to the original timeline."""
    try:
        result = model.transcribe(
            chunk_audio,
            language=None if args.language and args.language.lower() in ("auto", "detect") else args.language,
            temperature=0.0,
            beam_size=5,
            best_of=5,
            patience=1.0,
            compression_ratio_threshold=1.8,
            no_speech_threshold=0.6,
            no_repeat_ngram_size=3,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt or None,
            word_timestamps=False,
        )
        segments = list(result[0])
    except Exception as e:
        raise RuntimeError(f"faster-whisper transcription failed: {e}") from e

    out: list[dict] = []
    for seg in segments:
        start = float(getattr(seg, "start", 0.0) or 0.0) + chunk_offset_seconds
        end = float(getattr(seg, "end", 0.0) or 0.0) + chunk_offset_seconds
        entry = {
            "start": start,
            "end": end,
            "text": str(getattr(seg, "text", "") or "").strip(),
            "speaker": display_name,
            "no_speech_prob": float(getattr(seg, "no_speech_prob", 0.0) or 0.0),
            "avg_logprob": float(getattr(seg, "avg_logprob", 0.0) or 0.0),
        }
        out.append(entry)
    return out


def _combine_prompt(static_prompt: str | None, context_tail: str) -> str | None:
    static = (static_prompt or "").strip()
    tail = context_tail.strip()
    if static and tail:
        return f"{static}\n\n{tail}"
    return static or tail or None


class Job:
    __slots__ = ("file_id", "user_id", "display_name", "start", "end", "index")

    def __init__(self, file_id, user_id, display_name, start: int, end: int, index: int) -> None:
        self.file_id = file_id
        self.user_id = user_id
        self.display_name = display_name
        self.start = start
        self.end = end
        self.index = index


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="de")
    parser.add_argument("--fp16", type=lambda x: x.lower() == "true", default=False, help="deprecated; use --compute-type")
    parser.add_argument("--compute-type", default="int8", help="int8, int8_float16, float16 or float32")
    parser.add_argument("--condition-on-previous", type=lambda x: x.lower() != "false", default=True, help="feed the rolling conversation as context to each region")
    parser.add_argument("--trim-start", type=float, default=0)
    parser.add_argument("--trim-end", type=float, default=None)
    parser.add_argument("--manifest", required=True, help="'-' reads the JSON manifest {outputDir, files, completedFiles} from stdin")
    parser.add_argument("--initial-prompt", default=None)
    parser.add_argument("--noise-reduce", type=lambda x: x.lower() == "true", default=True)
    parser.add_argument("--vad-min-silence", type=float, default=2.0, help="seconds of silence that split speech regions")
    parser.add_argument("--vad-min-speech", type=float, default=0.5, help="minimum speech region duration in seconds")
    parser.add_argument("--filter-no-speech-prob", type=float, default=0.9)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
    except Exception as e:
        emit({"type": "error", "error": f"Failed to load faster-whisper: {e}. Run: python3 -m pip install --user faster-whisper"})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    try:
        manifest_text = sys.stdin.read() if args.manifest == "-" else args.manifest
        manifest = json.loads(manifest_text)
        files = manifest["files"]
        completed_files_arg = manifest.get("completedFiles", [])
        output_dir = manifest["outputDir"]
    except (json.JSONDecodeError, KeyError, OSError) as e:
        emit({"type": "error", "error": f"Invalid transcription manifest: {e}"})
        sys.exit(1)

    completed_by_id = {str(item.get("id")): item for item in completed_files_arg if item.get("id") is not None}

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

    errors: list[str] = []
    completed_files: list[dict] = []
    all_segments: list[dict] = []

    context_prefix = (args.initial_prompt or "").strip()
    context_lines: list[str] = []

    def format_line(start_s: float, name: str, text: str) -> str:
        return f"[{format_timestamp(start_s)}] {name}: {text}"

    def push_context(line: str) -> None:
        if not args.condition_on_previous:
            return
        context_lines.append(line)
        total = sum(len(l) + 1 for l in context_lines)
        while context_lines and total > _MAX_CONTEXT_CHARS:
            total -= len(context_lines.pop(0)) + 1

    # ------------------------------------------------------------------
    # 1) Load already completed files into the conversation context.
    # ------------------------------------------------------------------
    loaded_context: list[tuple[float, str]] = []
    for file_info in files:
        file_id = file_info.get("id")
        display_name = file_info.get("displayName", f"Speaker {file_info.get('index', 0) + 1}")
        completed_info = completed_by_id.get(str(file_id))
        if not (completed_info and completed_info.get("transcriptPath")):
            continue
        loaded = _load_completed_segments(completed_info["transcriptPath"], display_name, trim_start, trim_end)
        if loaded:
            all_segments.extend(loaded)
            for seg in loaded:
                loaded_context.append(
                    (
                        float(seg["start"]),
                        format_line(float(seg["start"]), str(seg["speaker"]), str(seg["text"])),
                    )
                )
            completed_files.append({
                "id": file_id,
                "userId": file_info.get("userId"),
                "transcriptPath": completed_info["transcriptPath"],
            })
            emit({"type": "file_complete", "index": int(file_info.get("index", 0)), "id": file_id, "userId": file_info.get("userId"), "transcriptPath": completed_info["transcriptPath"]})
    loaded_context.sort(key=lambda x: x[0])
    for _, line in loaded_context:
        push_context(line)

    # ------------------------------------------------------------------
    # 2) VAD over every not-yet-completed file -> global chronological jobs.
    # ------------------------------------------------------------------
    jobs: list[Job] = []
    pending_by_file: dict = {}
    audio_by_file: dict = {}
    total_speech_frames = 0
    for i, file_info in enumerate(files):
        file_id = file_info.get("id")
        user_id = file_info.get("userId")
        display_name = file_info.get("displayName", f"Speaker {i + 1}")
        if any(cf["id"] == file_id for cf in completed_files):
            continue

        wav_path = file_info.get("wavPath")
        audio_path = wav_path
        if args.noise_reduce:
            audio_path = preprocess_audio(wav_path)

        try:
            audio = decode_audio(audio_path, sampling_rate=_SAMPLE_RATE)
        except Exception as e:
            errors.append(f"{display_name}: failed to decode audio: {e}")
            emit({"type": "file_error", "index": i, "error": f"failed to decode audio: {e}"})
            continue

        try:
            intervals = _vad_speech_intervals(audio, args)
        except Exception as e:
            errors.append(f"{display_name}: VAD failed: {e}")
            emit({"type": "file_error", "index": i, "error": f"VAD failed: {e}"})
            continue

        file_jobs = []
        for start, end in intervals:
            start_s = start / _SAMPLE_RATE
            end_s = end / _SAMPLE_RATE
            if end_s <= trim_start or start_s >= trim_end:
                continue
            file_jobs.append(Job(file_id, user_id, display_name, start, end, i))
            total_speech_frames += int((end - start) / _SAMPLE_RATE * _FRAMES_PER_SECOND)

        jobs.extend(file_jobs)
        pending_by_file[str(file_id)] = {
            "file_info": file_info,
            "display_name": display_name,
            "segments": [],
        }
        audio_by_file[str(file_id)] = audio

    jobs.sort(key=lambda j: (j.start, j.index))

    _progress.reset(total_speech_frames)

    # ------------------------------------------------------------------
    # 3) Transcribe chunks in conversation order with a rolling context prompt.
    # ------------------------------------------------------------------
    if jobs:
        emit({"type": "progress", "message": f"Transcribing {len(jobs)} speech region(s) in conversation order"})

    remaining = {str(j.file_id): 0 for j in jobs}
    for j in jobs:
        remaining[str(j.file_id)] = remaining.get(str(j.file_id), 0) + 1

    started = set()

    for j in jobs:
        key = str(j.file_id)
        if key not in started:
            started.add(key)
            emit({"type": "file_start", "index": j.index, "total": len(files), "name": j.display_name})

        audio = audio_by_file.get(key)
        if audio is None:
            remaining[key] -= 1
            continue
        chunk = audio[j.start:j.end]
        context_tail = "\n".join(context_lines)
        prompt = _combine_prompt(context_prefix, context_tail)

        try:
            segments = _transcribe_chunk(
                model,
                chunk,
                j.start / _SAMPLE_RATE,
                j.display_name,
                args,
                prompt,
            )
        except Exception as e:
            errors.append(f"{j.display_name}: {e}")
            emit({"type": "file_error", "index": j.index, "error": str(e)})
            remaining[key] -= 1
            continue

        for seg in segments:
            if seg["end"] <= trim_start or seg["start"] >= trim_end:
                continue
            seg["start"] = max(seg["start"], trim_start)
            seg["end"] = min(seg["end"], trim_end)
            if _is_likely_hallucination(seg, args.filter_no_speech_prob, prompt):
                continue
            pending_by_file[key]["segments"].append(seg)
            all_segments.append(seg)
            push_context(format_line(seg["start"], seg["speaker"], seg["text"]))

        _progress.report_position(int(j.end / _SAMPLE_RATE * _FRAMES_PER_SECOND))

        remaining[key] -= 1
        if remaining[key] <= 0:
            # Finalize this speaker's transcript file.
            info = pending_by_file[key]
            segs = info["segments"]
            segs.sort(key=lambda s: s["start"])
            speaker_lines = [
                f"[{format_timestamp(seg['start'])}] {_apply_corrections(seg['text']).strip()}"
                for seg in segs
            ]
            transcript_filename = f"speaker-{_safe_filename_component(info['file_info'].get('userId'))}.txt"
            transcript_path = _contained_path(output_dir, transcript_filename)
            with open(_contained_path(output_dir, transcript_filename), "w", encoding="utf-8") as f:
                f.write("\n".join(speaker_lines))
            _write_segments(output_dir, transcript_filename, segs)

            completed_files.append({
                "id": info["file_info"].get("id"),
                "userId": info["file_info"].get("userId"),
                "transcriptPath": transcript_path,
            })
            emit({
                "type": "file_complete",
                "index": j.index,
                "id": info["file_info"].get("id"),
                "userId": info["file_info"].get("userId"),
                "transcriptPath": transcript_path,
            })
            audio_by_file.pop(key, None)
            pending_by_file.pop(key, None)

    # ------------------------------------------------------------------
    # 4) Merged conversation transcript.
    # ------------------------------------------------------------------
    if all_segments:
        all_segments.sort(key=lambda s: s["start"])
        transcript_lines = [
            f"[{format_timestamp(seg['start'])}] {seg['speaker']}: {_apply_corrections(seg['text']).strip()}"
            for seg in all_segments
        ]
        transcript = "\n".join(transcript_lines)
        transcript_path = _contained_path(output_dir, "transcript.txt")
        with open(_contained_path(output_dir, "transcript.txt"), "w", encoding="utf-8") as f:
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
