"""
ingest.py — ChatCosmos Step 1: Data Ingestion & Pre-processing
==============================================================

This module turns a directory of exported AI-chat logs into a flat list of
"chunks" — short, semantically coherent passages of conversation — that the
next step (embed_cluster.py) can embed and cluster.

Pipeline
--------
1. ``discover_chat_files`` recursively finds ``.json`` / ``.jsonl`` files.
2. ``parse_chat_file`` reads one file and returns a list of "raw message
   lists", where each inner list represents one conversation. It supports
   several common export formats (OpenAI/ChatGPT ``conversations.json`` with
   its nested ``mapping`` tree, Claude exports, and generic
   ``{"messages": [...]}`` / ``{"conversations": [...]}`` shapes).
3. ``normalize_messages`` flattens each conversation into a uniform list of
   dicts with keys ``role``, ``content``, ``timestamp``, ``source``,
   ``conversation_id``. Missing timestamps are inferred from neighbours or
   from the file's mtime.
4. ``chunk_conversation`` groups consecutive turns into ~500-word chunks,
   starting a new chunk on a topic shift (heuristic: gap > 30 min between
   timestamps) or when the word budget is exhausted.
5. ``ingest_directory`` orchestrates the above and dedupes near-identical
   chunks (hash on normalized text).

The result is a list of chunk dicts::

    {
        "text":             str,   # combined user+assistant text
        "role":             str,   # "user" | "assistant" (primary role)
        "timestamp":        str,   # ISO-8601 or None
        "source":           str,   # short label, e.g. "chatgpt-export"
        "conversation_id":  str,
        "word_count":       int,
        "title":            str    # ~first 8 words of the user turn
    }

CLI
---
    python ingest.py --input ./sample_data --output chunks.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
# Configure a module-level logger so callers can adjust verbosity. We attach
# a basic stderr handler only when run as a script; library users can attach
# their own handlers.
logger = logging.getLogger("chatcosmos.ingest")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
    logger.addHandler(_h)
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TOPIC_SHIFT_MINUTES: int = 30          # gap larger than this => new chunk
DEFAULT_MAX_WORDS: int = 500            # target chunk size in words
SUPPORTED_EXTENSIONS: tuple[str, ...] = (".json", ".jsonl")

# Regex used to strip non-alphanumeric chars for dedup hashing.
_NORMALIZE_RE = re.compile(r"[^a-z0-9\s]", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string (``Z`` suffix)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_iso(value: Any) -> Optional[str]:
    """
    Best-effort coercion of an arbitrary timestamp value to ISO-8601 UTC.

    Handles:
      * Already-formatted ISO strings (with or without trailing ``Z``)
      * POSIX epoch seconds (int / float)
      * POSIX epoch milliseconds (int / float that looks like ms)
      * ``None`` / empty -> returns ``None``
    """
    if value is None or value == "":
        return None

    # Already a string?
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # Normalise trailing Z to +00:00 so fromisoformat accepts it.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            # Some exports use a non-ISO format like "2024-03-15 10:30:00".
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(s, fmt)
                    break
                except ValueError:
                    continue
            else:
                logger.debug("Could not parse timestamp %r", value)
                return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Numeric: epoch seconds or milliseconds.
    if isinstance(value, (int, float)):
        try:
            # If the number is huge, it's probably milliseconds.
            if value > 1e12:
                value = value / 1000.0
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except (OverflowError, OSError, ValueError):
            return None

    return None


def _to_dt(iso: Optional[str]) -> Optional[datetime]:
    """Parse an ISO string produced by ``_to_iso`` back into a datetime."""
    if not iso:
        return None
    s = iso.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _word_count(text: str) -> int:
    """Cheap word counter (whitespace split)."""
    return len(text.split())


def _first_words(text: str, n: int = 8) -> str:
    """Return the first ``n`` words of ``text`` plus an ellipsis if truncated."""
    words = text.split()
    if not words:
        return ""
    head = " ".join(words[:n])
    if len(words) > n:
        head += "…"
    return head


def _flatten_content(content: Any) -> str:
    """
    Extract a plain-text body from a message ``content`` field that might be:

      * a string                       -> returned as-is
      * {"content_type": "text",
         "parts": ["...", "..."]}      -> joined parts (ChatGPT style)
      * {"text": "..."}                -> text field (Claude style)
      * a list of content blocks       -> concatenated text pieces
      * anything else                  -> JSON-stringified fallback
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content

    # ChatGPT-style: {"content_type": "text", "parts": [...]}
    if isinstance(content, dict):
        if "parts" in content and isinstance(content["parts"], list):
            return "\n".join(_flatten_content(p) for p in content["parts"])
        if "text" in content and isinstance(content["text"], str):
            return content["text"]
        if "content" in content:
            return _flatten_content(content["content"])
        # Fallback: stringify the dict for visibility (rare).
        try:
            return json.dumps(content, ensure_ascii=False)
        except (TypeError, ValueError):
            return ""

    # Anthropic-style content blocks: [{"type": "text", "text": "..."}, ...]
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if "text" in block and isinstance(block["text"], str):
                    parts.append(block["text"])
                elif block.get("type") == "text" and "text" in block:
                    parts.append(str(block["text"]))
                elif "content" in block:
                    parts.append(_flatten_content(block["content"]))
        return "\n".join(p for p in parts if p)

    return ""


# ---------------------------------------------------------------------------
# 1. File discovery
# ---------------------------------------------------------------------------
def discover_chat_files(input_dir: str | Path) -> list[Path]:
    """
    Recursively find all ``.json`` and ``.jsonl`` files under ``input_dir``.

    Files whose names look like package manifests (``package.json``,
    ``tsconfig.json``) or our own output (``chunks.json``,
    ``cosmos-data.json``) are skipped to avoid accidents.

    Returns a sorted list of ``Path`` objects (sorted by mtime, oldest first,
    so logs read chronologically).
    """
    root = Path(input_dir)
    if not root.exists():
        logger.error("Input directory does not exist: %s", root)
        return []
    if not root.is_dir():
        logger.error("Input path is not a directory: %s", root)
        return []

    skip_names = {
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "composer.json",
        "chunks.json",
        "cosmos-data.json",
    }

    found: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        if path.name.lower() in skip_names:
            continue
        found.append(path)

    # Sort by modification time so logs read in roughly chronological order.
    found.sort(key=lambda p: p.stat().st_mtime)
    logger.info("Discovered %d chat file(s) under %s", len(found), root)
    return found


# ---------------------------------------------------------------------------
# 2. Per-file parsing (multi-format)
# ---------------------------------------------------------------------------
def _source_label(path: Path) -> str:
    """Derive a short human-readable source label from a file path."""
    name = path.name.lower()
    if "conversations" in name or "chatgpt" in name:
        return "chatgpt-export"
    if "claude" in name:
        return "claude-export"
    if "gemini" in name:
        return "gemini-export"
    return path.stem


def _parse_chatgpt_conversations(payload: Any, source: str) -> list[list[dict]]:
    """
    Parse the OpenAI/ChatGPT ``conversations.json`` format.

    Top-level is a list of conversations; each conversation has a ``mapping``
    dict mapping node-id -> node, where each node may carry a ``message``
    with ``author.role`` and ``content``. The tree is rooted at the node with
    no parent; we walk children in order to recover linear history.
    """
    if not isinstance(payload, list):
        return []

    conversations: list[list[dict]] = []
    for convo in payload:
        if not isinstance(convo, dict) or "mapping" not in convo:
            continue
        mapping = convo["mapping"]
        if not isinstance(mapping, dict):
            continue

        convo_id = str(convo.get("id") or convo.get("title") or "unknown")
        convo_create = _to_iso(convo.get("create_time"))

        # Find root (a node whose parent is None).
        roots = [nid for nid, node in mapping.items()
                 if isinstance(node, dict) and node.get("parent") is None]
        if not roots:
            # Fall back to the first node id we can find.
            roots = list(mapping.keys())[:1]
        if not roots:
            continue

        messages: list[dict] = []
        seen: set[str] = set()
        # Walk the tree depth-first from the root, following the first child
        # at each step. (Real ChatGPT exports are mostly linear; branches are
        # rare and we keep only the main trunk for simplicity.)
        current: Optional[str] = roots[0]
        while current is not None and current not in seen:
            seen.add(current)
            node = mapping.get(current)
            if not isinstance(node, dict):
                break
            msg = node.get("message")
            if isinstance(msg, dict):
                role = (msg.get("author") or {}).get("role")
                content = _flatten_content(msg.get("content"))
                ts = _to_iso(msg.get("create_time")) or convo_create
                if role and content:
                    messages.append({
                        "role": role,
                        "content": content,
                        "timestamp": ts,
                        "source": source,
                        "conversation_id": convo_id,
                    })
            children = node.get("children") or []
            current = children[0] if isinstance(children, list) and children else None

        if messages:
            conversations.append(messages)

    return conversations


def _parse_messages_array(payload: Any, source: str) -> list[list[dict]]:
    """
    Parse generic formats where each conversation has a ``messages`` array:

      * {"messages": [...]}                         — single conversation
      * {"conversations": [{"messages": [...]}, …]} — multiple
      * [{"messages": [...]}, …]                     — list of convos
      * {"chats": [{"messages": [...]}, …]}          — Claude-style wrapper

    Each message may use any of these field name conventions:
      role / sender / author        (string or {"role": "..."})
      content / text / parts        (string or structured)
      timestamp / created_at / create_time / time / date
    """
    conversations_raw: list[Any] = []

    if isinstance(payload, dict):
        if "conversations" in payload and isinstance(payload["conversations"], list):
            conversations_raw = payload["conversations"]
        elif "chats" in payload and isinstance(payload["chats"], list):
            conversations_raw = payload["chats"]
        elif "messages" in payload and isinstance(payload["messages"], list):
            conversations_raw = [payload]
        else:
            # Unknown dict shape; try treating the whole thing as one convo.
            conversations_raw = [payload]
    elif isinstance(payload, list):
        conversations_raw = payload
    else:
        return []

    conversations: list[list[dict]] = []
    for idx, convo in enumerate(conversations_raw):
        if not isinstance(convo, dict):
            continue
        raw_messages = convo.get("messages")
        if not isinstance(raw_messages, list):
            continue
        convo_id = str(convo.get("id") or convo.get("uuid")
                       or convo.get("name") or f"conv-{idx}")
        convo_create = _to_iso(convo.get("created_at") or convo.get("create_time")
                               or convo.get("timestamp"))

        msgs: list[dict] = []
        for m in raw_messages:
            if not isinstance(m, dict):
                continue
            role = (m.get("role") or m.get("sender") or m.get("author")
                    or m.get("from") or "unknown")
            if isinstance(role, dict):
                role = role.get("role") or role.get("name") or "unknown"
            role = str(role).lower().strip()

            content = _flatten_content(
                m.get("content") or m.get("text") or m.get("parts") or m.get("body")
            )
            if not content:
                # Skip messages with no textual body (e.g. tool calls).
                continue

            ts = _to_iso(
                m.get("timestamp") or m.get("created_at")
                or m.get("create_time") or m.get("time") or m.get("date")
            ) or convo_create

            msgs.append({
                "role": role,
                "content": content,
                "timestamp": ts,
                "source": source,
                "conversation_id": convo_id,
            })
        if msgs:
            conversations.append(msgs)

    return conversations


def parse_chat_file(path: str | Path) -> list[list[dict]]:
    """
    Parse a single chat-export file into a list of conversations,
    where each conversation is a list of message dicts (already in the
    "normalized" shape produced by ``_parse_*`` helpers above).

    Supports ``.json`` (one JSON value, possibly a list) and ``.jsonl``
    (one JSON object per line, each treated as a separate conversation).

    Auto-detects format by inspecting the structure; ChatGPT's ``mapping``
    tree is detected when the top-level list contains dicts with a
    ``mapping`` key.
    """
    p = Path(path)
    source = _source_label(p)

    try:
        raw_text = p.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        logger.error("Could not read %s: %s", p, exc)
        return []

    if not raw_text.strip():
        logger.warning("Skipping empty file: %s", p)
        return []

    # ---- JSONL: one conversation per line -------------------------------
    if p.suffix.lower() == ".jsonl":
        conversations: list[list[dict]] = []
        for line_no, line in enumerate(raw_text.splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                logger.warning("%s:%d: skipping malformed line (%s)", p, line_no, exc)
                continue
            # Reuse the generic parser on a single-object list.
            conversations.extend(_parse_messages_array(obj, source))
        return conversations

    # ---- Plain JSON -----------------------------------------------------
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        logger.error("%s: invalid JSON (%s)", p, exc)
        return []

    # ChatGPT detection: list of objects each carrying "mapping". We also
    # tolerate "messy" exports where a single file mixes ChatGPT-style
    # entries (with a ``mapping`` tree) and generic entries (with a
    # ``messages`` array) — each element is dispatched to the right parser.
    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        if "mapping" in payload[0]:
            logger.debug("Detected ChatGPT conversations.json format in %s", p)
            conversations: list[list[dict]] = []
            for entry in payload:
                if not isinstance(entry, dict):
                    continue
                if "mapping" in entry:
                    conversations.extend(
                        _parse_chatgpt_conversations([entry], source)
                    )
                else:
                    # Generic entry mixed into a ChatGPT-style export.
                    conversations.extend(_parse_messages_array(entry, source))
            return conversations

    # Generic.
    return _parse_messages_array(payload, source)


# ---------------------------------------------------------------------------
# 3. Normalization & timestamp inference
# ---------------------------------------------------------------------------
def normalize_messages(raw_messages: list[dict]) -> list[dict]:
    """
    Take the output of ``parse_chat_file`` (already nearly uniform) and
    finalize it:

      * Coerce ``role`` to canonical values ("user"/"assistant"/"system").
      * Strip whitespace from ``content``; drop empties.
      * Infer missing timestamps from neighbours (linear interpolation in
        1-minute increments; if no neighbour has a timestamp, fall back to
        ``None``).

    Returns a list of dicts with keys ``role``, ``content``, ``timestamp``,
    ``source``, ``conversation_id``.
    """
    if not raw_messages:
        return []

    # ---- role canonicalization -----------------------------------------
    role_map = {
        "human": "user",
        "you": "user",
        "me": "user",
        "customer": "user",
        "ai": "assistant",
        "bot": "assistant",
        "model": "assistant",
        "gpt": "assistant",
        "claude": "assistant",
        "chatgpt": "assistant",
        "system": "system",
        "tool": "tool",
        "function": "tool",
    }

    msgs: list[dict] = []
    for m in raw_messages:
        role = role_map.get(m.get("role", "").lower().strip(), m.get("role", "unknown"))
        content = (m.get("content") or "").strip()
        if not content:
            continue
        msgs.append({
            "role": role,
            "content": content,
            "timestamp": m.get("timestamp"),
            "source": m.get("source", "unknown"),
            "conversation_id": m.get("conversation_id", "unknown"),
        })

    if not msgs:
        return []

    # ---- timestamp inference -------------------------------------------
    # First pass: parse existing timestamps into datetimes.
    dts: list[Optional[datetime]] = [_to_dt(m["timestamp"]) for m in msgs]

    # If everything is missing, leave timestamps as None — we can't help.
    if any(d is not None for d in dts):
        # Forward-fill from the previous known timestamp (+60s per gap).
        last_dt: Optional[datetime] = None
        for i, dt in enumerate(dts):
            if dt is not None:
                last_dt = dt
            elif last_dt is not None:
                # Step forward by 1 minute per missing message.
                last_dt = last_dt + timedelta_minutes(1)
                dts[i] = last_dt

        # Backward-fill from the next known timestamp for any leading Nones.
        next_dt: Optional[datetime] = None
        for i in range(len(dts) - 1, -1, -1):
            if dts[i] is not None:
                next_dt = dts[i]
            elif next_dt is not None:
                next_dt = next_dt - timedelta_minutes(1)
                dts[i] = next_dt

    for m, dt in zip(msgs, dts):
        m["timestamp"] = dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None

    return msgs


def timedelta_minutes(minutes: int) -> "Any":
    """Lazy import of ``timedelta`` to keep module import-time deps minimal."""
    from datetime import timedelta
    return timedelta(minutes=minutes)


# ---------------------------------------------------------------------------
# 4. Chunking
# ---------------------------------------------------------------------------
def chunk_conversation(messages: list[dict],
                       max_words: int = DEFAULT_MAX_WORDS) -> list[dict]:
    """
    Combine consecutive user+assistant turns into semantic chunks of
    ~``max_words`` words.

    Rules
    -----
    * Start a new chunk when:
        - the gap between two consecutive timestamps exceeds
          ``TOPIC_SHIFT_MINUTES`` (a heuristic topic shift), OR
        - the running word count would exceed ``max_words``.
    * The primary ``role`` of a chunk is the role of its first message
      (usually ``user``); a chunk may contain both user and assistant text.
    * ``title`` is the first ~8 words of the first user message in the chunk.
    * Chunks with only ``system``/``tool`` messages are skipped (they are
      rarely meaningful on their own).

    Returns a list of chunk dicts::

        {text, role, timestamp, source, conversation_id, word_count, title}
    """
    if not messages:
        return []

    chunks: list[dict] = []
    current_parts: list[str] = []
    current_words: int = 0
    current_role: str = "user"
    current_ts: Optional[str] = None
    current_source: str = messages[0].get("source", "unknown")
    current_convo: str = messages[0].get("conversation_id", "unknown")
    current_title: str = ""

    def _flush() -> None:
        nonlocal current_parts, current_words, current_role, current_ts
        nonlocal current_title
        if not current_parts:
            return
        text = "\n".join(current_parts).strip()
        if not text:
            current_parts = []
            current_words = 0
            current_title = ""
            return
        # Skip pure system/tool chunks.
        if current_role in ("system", "tool") and not any(
            m.get("role") in ("user", "assistant") for m in current_buffer_msgs
        ):
            current_parts = []
            current_words = 0
            current_title = ""
            return
        chunks.append({
            "text": text,
            "role": current_role,
            "timestamp": current_ts,
            "source": current_source,
            "conversation_id": current_convo,
            "word_count": current_words,
            "title": current_title,
        })
        current_parts = []
        current_words = 0
        current_title = ""

    # We need to peek at the messages that went into the current chunk to
    # decide whether to skip pure-system chunks; keep a parallel buffer.
    current_buffer_msgs: list[dict] = []

    prev_dt: Optional[datetime] = None
    for m in messages:
        role = m["role"]
        content = m["content"]
        ts = m.get("timestamp")
        dt = _to_dt(ts)

        # Topic-shift detection: large gap between consecutive timestamps.
        if prev_dt is not None and dt is not None:
            gap_min = (dt - prev_dt).total_seconds() / 60.0
            if gap_min > TOPIC_SHIFT_MINUTES and current_parts:
                _flush()
                current_buffer_msgs = []
                prev_dt = dt

        # Word-budget overflow.
        msg_words = _word_count(content)
        if current_parts and current_words + msg_words > max_words:
            _flush()
            current_buffer_msgs = []

        # Start a new chunk: capture metadata from the first message.
        if not current_parts:
            current_role = role
            current_ts = ts
            current_source = m.get("source", current_source)
            current_convo = m.get("conversation_id", current_convo)
            # Title: prefer the first USER message; fall back to whatever
            # role opened the chunk.
            if role == "user":
                current_title = _first_words(content, 8)
            else:
                current_title = _first_words(content, 8)

        # Prefix each segment with its role so downstream TF-IDF sees the
        # speaker (and so the final ``fullText`` in the JSON contract reads
        # naturally: "User: ...\nAssistant: ...").
        speaker = {"user": "User", "assistant": "Assistant"}.get(role, role.capitalize())
        current_parts.append(f"{speaker}: {content}")
        current_buffer_msgs.append(m)
        current_words += msg_words

        # If the chunk opened with a non-user role and we encounter the
        # first user message, set the title from it.
        if role == "user" and not current_title.strip("…").strip():
            current_title = _first_words(content, 8)

        prev_dt = dt

    _flush()
    return chunks


# ---------------------------------------------------------------------------
# 5. Deduplication
# ---------------------------------------------------------------------------
def _dedup_hash(text: str) -> str:
    """Return a stable hash of normalized text for near-duplicate detection."""
    normalized = _NORMALIZE_RE.sub(" ", text.lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()


def _dedupe_chunks(chunks: list[dict]) -> list[dict]:
    """
    Remove near-identical chunks (same normalized text).

    Keeps the first occurrence. Useful when an export contains the same
    conversation duplicated, or when two exports overlap.
    """
    seen: set[str] = set()
    unique: list[dict] = []
    dropped = 0
    for c in chunks:
        h = _dedup_hash(c["text"])
        if h in seen:
            dropped += 1
            continue
        seen.add(h)
        unique.append(c)
    if dropped:
        logger.info("Dropped %d duplicate chunk(s)", dropped)
    return unique


# ---------------------------------------------------------------------------
# 6. Directory orchestrator
# ---------------------------------------------------------------------------
def ingest_directory(input_dir: str | Path,
                     max_words: int = DEFAULT_MAX_WORDS) -> list[dict]:
    """
    Top-level entry point: discover files, parse, normalize, chunk, dedupe.

    Args:
        input_dir: directory containing exported chat logs.
        max_words: target chunk size in words.

    Returns:
        A flat list of chunk dicts ready for embedding.
    """
    files = discover_chat_files(input_dir)
    if not files:
        logger.warning("No chat files found under %s — producing empty output.",
                       input_dir)
        return []

    all_chunks: list[dict] = []
    total_messages = 0

    for path in files:
        try:
            conversations = parse_chat_file(path)
        except Exception as exc:  # noqa: BLE001 — we want to keep going.
            logger.exception("Failed to parse %s: %s", path, exc)
            continue

        file_chunks = 0
        for convo in conversations:
            msgs = normalize_messages(convo)
            total_messages += len(msgs)
            chunks = chunk_conversation(msgs, max_words=max_words)
            all_chunks.extend(chunks)
            file_chunks += len(chunks)

        logger.info("Parsed %s: %d conversation(s), %d chunk(s)",
                    path.name, len(conversations), file_chunks)

    logger.info("Ingested %d messages across %d file(s) -> %d chunks (pre-dedup)",
                total_messages, len(files), len(all_chunks))

    unique = _dedupe_chunks(all_chunks)
    logger.info("After dedup: %d chunks", len(unique))
    return unique


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ingest.py",
        description="ChatCosmos Step 1 — ingest chat exports into chunks.json",
    )
    p.add_argument("--input", "-i", required=True,
                   help="Directory containing exported chat logs (.json/.jsonl).")
    p.add_argument("--output", "-o", default="chunks.json",
                   help="Output path for the chunk list (default: chunks.json).")
    p.add_argument("--max-words", type=int, default=DEFAULT_MAX_WORDS,
                   help=f"Target chunk size in words (default: {DEFAULT_MAX_WORDS}).")
    p.add_argument("--verbose", "-v", action="store_true",
                   help="Enable DEBUG-level logging.")
    return p


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    chunks = ingest_directory(args.input, max_words=args.max_words)
    if not chunks:
        logger.error("No chunks produced; nothing to write.")
        return 1

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(chunks, fh, ensure_ascii=False, indent=2)

    logger.info("Wrote %d chunks to %s", len(chunks), out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
