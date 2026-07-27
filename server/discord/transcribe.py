import argparse
import json
import os
import sys
import traceback


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def format_timestamp(seconds: float) -> str:
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--language", default="de")
    parser.add_argument("--fp16", type=lambda x: x.lower() == "true", default=False)
    parser.add_argument("--trim-start", type=float, default=0)
    parser.add_argument("--trim-end", type=float, default=None)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--files", required=True, help="JSON array of {id, userId, wavPath, displayName}")
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

    all_segments = []
    errors = []
    completed_files = []

    for i, file_info in enumerate(files):
        file_id = file_info.get("id")
        wav_path = file_info.get("wavPath")
        user_id = file_info.get("userId")
        display_name = file_info.get("displayName", f"Speaker {i + 1}")

        emit({"type": "file_start", "index": i, "total": len(files), "name": display_name})

        try:
            result = model.transcribe(
                wav_path,
                language=args.language,
                fp16=args.fp16,
                verbose=False,
            )

            file_segments = []
            for seg in result.get("segments", []):
                if seg["end"] <= trim_start or seg["start"] >= trim_end:
                    continue
                seg["start"] = max(seg["start"], trim_start)
                seg["end"] = min(seg["end"], trim_end)
                seg["speaker"] = display_name
                file_segments.append(seg)
                all_segments.append(seg)

            speaker_lines = [
                f"[{format_timestamp(seg['start'])}] {seg['text'].strip()}"
                for seg in file_segments
            ]
            transcript_path = os.path.join(output_dir, f"speaker-{user_id}.txt")
            with open(transcript_path, "w", encoding="utf-8") as f:
                f.write("\n".join(speaker_lines))

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
