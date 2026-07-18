"""
run_pipeline.py — ChatCosmos end-to-end orchestrator
====================================================

Runs the two-step ChatCosmos preprocessing pipeline:

    ingest.py            (Step 1) → chunks.json
    embed_cluster.py     (Step 2) → cosmos-data.json

The intermediate ``chunks.json`` is written to a cache directory so repeated
runs can skip Step 1 if the inputs haven't changed (the embed step also
caches its own embeddings, so the whole pipeline is fast to re-run when
tuning only the cluster/projection parameters).

Typical usage
-------------
    python run_pipeline.py \\
        --input ./sample_data \\
        --output ../public/data/cosmos-data.json

The frontend (Next.js) reads the output file from
``public/data/cosmos-data.json`` so it is served at
``/data/cosmos-data.json``.
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger("chatcosmos.pipeline")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
    logger.addHandler(_h)
logger.setLevel(logging.INFO)

# Make sure child module loggers propagate to our handler.
logging.getLogger("chatcosmos.ingest").setLevel(logging.INFO)
logging.getLogger("chatcosmos.embed").setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_OUTPUT: str = "../public/data/cosmos-data.json"
DEFAULT_MAX_WORDS: int = 500
DEFAULT_MIN_CLUSTER_SIZE: int = 15
DEFAULT_MODEL: str = "all-MiniLM-L6-v2"
DEFAULT_CHUNKS_CACHE: str = ".cache/chunks.json"


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    """Run the full ingest → embed → cluster → project → export pipeline."""
    parser = argparse.ArgumentParser(
        prog="run_pipeline.py",
        description="ChatCosmos preprocessing pipeline: "
                    "ingest chat exports and emit cosmos-data.json.",
    )
    parser.add_argument("--input", "-i", required=True,
                        help="Directory containing exported chat logs.")
    parser.add_argument("--output", "-o", default=DEFAULT_OUTPUT,
                        help=f"Output path for cosmos-data.json "
                             f"(default: {DEFAULT_OUTPUT}).")
    parser.add_argument("--max-words", type=int, default=DEFAULT_MAX_WORDS,
                        help=f"Target chunk size in words "
                             f"(default: {DEFAULT_MAX_WORDS}).")
    parser.add_argument("--min-cluster-size", type=int,
                        default=DEFAULT_MIN_CLUSTER_SIZE,
                        help=f"HDBSCAN min_cluster_size "
                             f"(default: {DEFAULT_MIN_CLUSTER_SIZE}).")
    parser.add_argument("--embedding-model", default=DEFAULT_MODEL,
                        help=f"sentence-transformers model name "
                             f"(default: {DEFAULT_MODEL}).")
    parser.add_argument("--chunks-cache", default=DEFAULT_CHUNKS_CACHE,
                        help=f"Intermediate chunks.json path "
                             f"(default: {DEFAULT_CHUNKS_CACHE}).")
    parser.add_argument("--no-cache", action="store_true",
                        help="Force re-ingest even if chunks cache exists.")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable DEBUG-level logging.")
    args = parser.parse_args(argv)

    if args.verbose:
        logging.getLogger("chatcosmos").setLevel(logging.DEBUG)

    # Import the two steps as local modules so this script works regardless
    # of where it's invoked from.
    import ingest as ingest_mod
    import embed_cluster as embed_mod

    # ===================================================================
    # Step 1: Ingest
    # ===================================================================
    logger.info("=" * 60)
    logger.info("STEP 1 — Ingesting chat exports from %s", args.input)
    logger.info("=" * 60)

    chunks_path = Path(args.chunks_cache)
    chunks_path.parent.mkdir(parents=True, exist_ok=True)

    if chunks_path.exists() and not args.no_cache:
        logger.info("Found existing chunks cache at %s (use --no-cache to "
                    "force re-ingest).", chunks_path)
        try:
            chunks = embed_mod.load_chunks(chunks_path)
        except (FileNotFoundError, ValueError) as exc:
            logger.warning("Cache unreadable (%s); re-ingesting.", exc)
            chunks = ingest_mod.ingest_directory(args.input,
                                                 max_words=args.max_words)
            _write_chunks(chunks, chunks_path)
    else:
        chunks = ingest_mod.ingest_directory(args.input,
                                             max_words=args.max_words)
        _write_chunks(chunks, chunks_path)

    if not chunks:
        logger.error("No chunks produced. Aborting.")
        return 1

    logger.info("Step 1 complete: %d chunks", len(chunks))

    # ===================================================================
    # Step 2: Embed, cluster, project, export
    # ===================================================================
    logger.info("=" * 60)
    logger.info("STEP 2 — Embedding, clustering, and projecting to 3-D")
    logger.info("=" * 60)

    texts = [c.get("text", "") for c in chunks]

    # ---- Embedding (cached by content hash) ---------------------------
    try:
        emb = embed_mod.compute_embeddings(
            texts, model_name=args.embedding_model
        )
    except SystemExit as exc:
        # _require() in embed_cluster raises SystemExit with a helpful message.
        logger.error("%s", exc)
        return 1

    # ---- Clustering (on high-dim embeddings) --------------------------
    try:
        labels, n_clusters = embed_mod.cluster_embeddings(
            emb, min_cluster_size=args.min_cluster_size
        )
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- 3-D projection -----------------------------------------------
    try:
        coords = embed_mod.reduce_to_3d(emb)
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- Topic keywords -----------------------------------------------
    try:
        keywords, cluster_labels = embed_mod.extract_topic_keywords(texts, labels)
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- Colors --------------------------------------------------------
    colors = embed_mod.assign_colors(n_clusters)

    # ---- Assemble final JSON ------------------------------------------
    payload = embed_mod.build_cosmos_json(
        chunks=chunks,
        coords=coords,
        labels=labels,
        keywords=keywords,
        cluster_labels=cluster_labels,
        colors=colors,
        source="chat-exports",
    )

    # ---- Save ---------------------------------------------------------
    embed_mod.save_json(payload, args.output)

    # ===================================================================
    # Summary
    # ===================================================================
    md = payload["metadata"]
    dr = md["dateRange"]
    print()
    print("=" * 60)
    print(" ChatCosmos pipeline complete")
    print("=" * 60)
    print(f"  Input dir      : {args.input}")
    print(f"  Output file    : {args.output}")
    print(f"  Total nodes    : {md['totalNodes']}")
    print(f"  Total clusters : {md['totalClusters']}")
    print(f"  Date range     : {dr.get('start', 'n/a')}")
    print(f"                   -> {dr.get('end', 'n/a')}")
    print(f"  Generated at   : {md['generatedAt']}")
    print()
    # Per-cluster breakdown for quick sanity check.
    print("  Cluster breakdown:")
    for c in payload["clusters"]:
        kws = ", ".join(c["keywords"][:3]) if c["keywords"] else "(no keywords)"
        print(f"    #{c['id']:>2}  {c['label']:<14}  "
              f"count={c['count']:>4}  color={c['color']}  "
              f"keywords=[{kws}]")
    print("=" * 60)
    return 0


def _write_chunks(chunks: list[dict], path: Path) -> None:
    """Persist intermediate chunks to ``path`` as JSON."""
    import json
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(chunks, fh, ensure_ascii=False, indent=2)
    logger.info("Wrote intermediate chunks to %s", path)


if __name__ == "__main__":
    # When invoked as a script, raise SystemExit with the return code so the
    # shell sees a proper exit status.
    raise SystemExit(main())
