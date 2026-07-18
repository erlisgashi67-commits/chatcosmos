"""
embed_cluster.py — ChatCosmos Step 2: Embedding & 3D Projection
===============================================================

This module takes the chunk list produced by ``ingest.py`` and turns it into
the final ``cosmos-data.json`` consumed by the Next.js frontend.

Pipeline
--------
1. ``load_chunks`` reads ``chunks.json``.
2. ``compute_embeddings`` encodes each chunk's text with a
   sentence-transformers model. Embeddings are cached on disk keyed by a hash
   of (model name + texts) so re-runs are cheap.
3. ``reduce_to_3d`` projects the high-dimensional embeddings down to 3-D with
   UMAP and rescales the result into roughly [-50, 50] (a comfortable size
   for the Three.js scene).
4. ``cluster_embeddings`` runs HDBSCAN on the (high- or low-dimensional)
   embeddings and assigns every point — including HDBSCAN's noise points
   (label ``-1``) — to a real cluster.
5. ``extract_topic_keywords`` runs per-cluster TF-IDF to pick representative
   keywords and derives a short human label.
6. ``assign_colors`` returns a curated palette of distinct hex colors.
7. ``build_cosmos_json`` assembles the full JSON dict that matches the
   project's data contract, and ``save_json`` writes it out.

CLI
---
    python embed_cluster.py \\
        --input chunks.json \\
        --output ../public/data/cosmos-data.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Optional-dependency imports
# ---------------------------------------------------------------------------
# We import the heavy ML deps lazily / defensively so that the module can be
# imported (and the CLI can print a helpful install hint) even when the user
# hasn't run ``pip install -r requirements.txt`` yet.

_NP_IMPORT_ERROR: Optional[str] = None
try:
    import numpy as np  # noqa: F401  (re-exported below)
except ImportError as exc:  # pragma: no cover
    _NP_IMPORT_ERROR = str(exc)
    np = None  # type: ignore[assignment]


def _require(modules: dict[str, str], purpose: str) -> None:
    """
    Lazily import a heavy dependency and raise a helpful error if missing.

    ``modules`` maps the attribute name we want to expose -> the package the
    user must ``pip install`` to get it. We try to import each in turn; the
    first missing one triggers an error message with install instructions.
    """
    for attr, pkg in modules.items():
        try:
            mod = __import__(pkg)
        except ImportError as exc:
            raise SystemExit(
                f"\n[ChatCosmos] Missing dependency '{pkg}' for {purpose}.\n"
                f"  Install it with:  pip install -r requirements.txt\n"
                f"  (Original error: {exc})\n"
            ) from exc
        globals()[attr] = mod


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logger = logging.getLogger("chatcosmos.embed")
if not logger.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s"))
    logger.addHandler(_h)
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_MODEL: str = "all-MiniLM-L6-v2"
DEFAULT_BATCH: int = 64
DEFAULT_N_NEIGHBORS: int = 15
DEFAULT_MIN_DIST: float = 0.1
DEFAULT_MIN_CLUSTER_SIZE: int = 15
DEFAULT_TOP_N_KEYWORDS: int = 5
RANDOM_SEED: int = 42

# Target spatial extent for the projected galaxy. The frontend camera is
# tuned for points roughly in [-50, 50]; we rescale UMAP output to fit.
SCENE_RADIUS: float = 50.0

CACHE_DIR: Path = Path(".cache")


# ---------------------------------------------------------------------------
# 1. Load chunks
# ---------------------------------------------------------------------------
def load_chunks(path: str | Path) -> list[dict]:
    """
    Read a ``chunks.json`` file produced by ``ingest.py``.

    Accepts either a bare JSON list of chunk dicts, or a wrapper dict with a
    ``"chunks"`` key (we stay forgiving).
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Input chunks file not found: {p}")
    with p.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if isinstance(payload, list):
        chunks = payload
    elif isinstance(payload, dict) and "chunks" in payload:
        chunks = payload["chunks"]
    else:
        raise ValueError(
            "Unrecognized chunks.json shape: expected a list or "
            "an object with a 'chunks' key."
        )
    logger.info("Loaded %d chunks from %s", len(chunks), p)
    return chunks


# ---------------------------------------------------------------------------
# 2. Embeddings (with on-disk cache)
# ---------------------------------------------------------------------------
def _texts_hash(texts: list[str], model_name: str) -> str:
    """Stable hash of (model name + full text list) for cache keying."""
    h = hashlib.sha1()
    h.update(model_name.encode("utf-8"))
    for t in texts:
        h.update(b"\x1e")  # record separator
        h.update(t.encode("utf-8", errors="replace"))
    return h.hexdigest()


def compute_embeddings(texts: list[str],
                       model_name: str = DEFAULT_MODEL,
                       batch_size: int = DEFAULT_BATCH) -> "np.ndarray":
    """
    Encode a list of texts into a dense ``(N, D)`` float matrix using a
    sentence-transformers model.

    Embeddings are cached at ``.cache/embeddings-{hash}.npy`` keyed by a hash
    of (model_name + texts); if a matching cache file exists it is loaded
    directly without re-running the model.
    """
    if not texts:
        raise ValueError("Cannot embed an empty text list.")

    _require({"sentence_transformers": "sentence_transformers"},
             "computing embeddings")
    from sentence_transformers import SentenceTransformer  # type: ignore
    _require({"np": "numpy"}, "computing embeddings")

    # ---- cache lookup --------------------------------------------------
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = _texts_hash(texts, model_name)
    cache_path = CACHE_DIR / f"embeddings-{key}.npy"
    if cache_path.exists():
        logger.info("Loading cached embeddings from %s", cache_path)
        return np.load(cache_path)  # type: ignore[union-attr]

    # ---- compute -------------------------------------------------------
    logger.info("Loading embedding model '%s'...", model_name)
    model = SentenceTransformer(model_name)
    # tqdm progress bar comes for free from sentence-transformers when the
    # ``show_progress_bar`` flag is set.
    logger.info("Encoding %d texts (batch_size=%d)...", len(texts), batch_size)
    emb = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=False,
    )
    emb = np.asarray(emb, dtype=np.float32)  # type: ignore[union-attr]
    logger.info("Embedding shape: %s", emb.shape)

    # ---- persist -------------------------------------------------------
    np.save(cache_path, emb)  # type: ignore[union-attr]
    logger.info("Cached embeddings to %s", cache_path)
    return emb


# ---------------------------------------------------------------------------
# 3. UMAP reduction to 3-D
# ---------------------------------------------------------------------------
def reduce_to_3d(embeddings: "np.ndarray",
                 n_neighbors: int = DEFAULT_N_NEIGHBORS,
                 min_dist: float = DEFAULT_MIN_DIST) -> "np.ndarray":
    """
    Project a high-dimensional embedding matrix into 3-D using UMAP.

    The output is centered on the origin and rescaled so the maximum
    coordinate magnitude across all axes is approximately ``SCENE_RADIUS``
    (default 50). This keeps the galaxy comfortably framed by the Three.js
    camera setup in the frontend.

    UMAP is seeded with ``RANDOM_SEED`` for reproducibility.
    """
    _require({"np": "numpy"}, "reducing to 3D")
    _require({"umap": "umap"}, "reducing to 3D")
    from umap import UMAP  # type: ignore

    if embeddings.shape[0] < 2:
        raise ValueError("Need at least 2 embeddings to run UMAP.")

    # ``n_neighbors`` can't exceed the number of samples; clamp it.
    n_neighbors = max(2, min(n_neighbors, embeddings.shape[0] - 1))

    reducer = UMAP(
        n_components=3,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric="cosine",
        random_state=RANDOM_SEED,
    )
    coords = reducer.fit_transform(embeddings).astype(np.float32)  # type: ignore[union-attr]

    # ---- rescale to roughly [-SCENE_RADIUS, SCENE_RADIUS] -------------
    # Center on origin, then scale so the max abs coordinate across all
    # axes equals SCENE_RADIUS. We use max (not std) so the galaxy always
    # fills the same spatial envelope regardless of UMAP's natural spread.
    coords = coords - coords.mean(axis=0, keepdims=True)
    max_abs = float(np.max(np.abs(coords)))  # type: ignore[union-attr]
    if max_abs > 1e-6:
        coords = coords * (SCENE_RADIUS / max_abs)
    return coords


# ---------------------------------------------------------------------------
# 4. HDBSCAN clustering
# ---------------------------------------------------------------------------
def cluster_embeddings(embeddings: "np.ndarray",
                       min_cluster_size: int = DEFAULT_MIN_CLUSTER_SIZE
                       ) -> tuple["np.ndarray", int]:
    """
    Cluster the embeddings with HDBSCAN.

    Returns ``(labels, n_clusters)`` where ``labels`` is an int array of
    length ``N`` with values in ``[0, n_clusters)`` (no ``-1`` noise labels
    — those are reassigned below).

    Noise handling
    --------------
    HDBSCAN labels low-density points as ``-1`` (noise). For a galaxy view
    we want every point to belong to a cluster so it can be colored, so we
    reassign each noise point to the cluster whose centroid is nearest in
    embedding space. If *all* points are noise (rare, e.g. tiny input), we
    fall back to a single catch-all cluster 0.
    """
    _require({"np": "numpy"}, "clustering")
    _require({"hdbscan": "hdbscan"}, "clustering")
    import hdbscan  # type: ignore

    n = embeddings.shape[0]
    if n == 0:
        return (np.array([], dtype=np.int64), 0)  # type: ignore[union-attr]

    # HDBSCAN needs at least ``min_cluster_size`` points to form a cluster;
    # clamp the parameter so it never exceeds the dataset size.
    min_cluster_size = max(2, min(min_cluster_size, n))

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        metric="euclidean",
        cluster_selection_method="eom",  # Excess of Mass — fewer tiny clusters
    )
    raw_labels = clusterer.fit_predict(embeddings)

    # ---- reassign noise points ----------------------------------------
    unique_labels = set(int(x) for x in np.unique(raw_labels)  # type: ignore[union-attr]
                        if int(x) != -1)
    if not unique_labels:
        # No real clusters found — everything is noise. Put it all in one
        # "misc" cluster so the frontend still has something to render.
        logger.warning("HDBSCAN found no clusters; assigning all points to a "
                       "single misc cluster.")
        return (np.zeros(n, dtype=np.int64), 1)  # type: ignore[union-attr]

    # Compute per-cluster centroids in embedding space.
    labels = raw_labels.copy()
    noise_mask = labels == -1
    if noise_mask.any():
        centroids = np.stack([  # type: ignore[union-attr]
            embeddings[raw_labels == c].mean(axis=0) for c in sorted(unique_labels)
        ])
        noise_points = embeddings[noise_mask]
        # Nearest centroid via euclidean distance.
        # ``centroids`` has shape (k, D); ``noise_points`` has shape (m, D).
        # We compute pairwise distances and take argmin.
        dists = np.linalg.norm(  # type: ignore[union-attr]
            noise_points[:, None, :] - centroids[None, :, :], axis=2
        )
        nearest = dists.argmin(axis=1)
        # Map back to actual cluster ids (sorted unique labels).
        sorted_ids = np.array(sorted(unique_labels))  # type: ignore[union-attr]
        labels[noise_mask] = sorted_ids[nearest]
        logger.info("Reassigned %d noise point(s) to nearest clusters.",
                    int(noise_mask.sum()))

    # Relabel contiguously 0..k-1 (in case some cluster ids are missing
    # after the above; this keeps colors/keywords arrays tight).
    final_ids = sorted(set(int(x) for x in np.unique(labels)))  # type: ignore[union-attr]
    remap = {old: new for new, old in enumerate(final_ids)}
    labels = np.array([remap[int(x)] for x in labels], dtype=np.int64)  # type: ignore[union-attr]
    n_clusters = len(final_ids)
    logger.info("Clustered into %d cluster(s).", n_clusters)
    return labels, n_clusters


# ---------------------------------------------------------------------------
# 5. Topic keywords via TF-IDF
# ---------------------------------------------------------------------------
def extract_topic_keywords(texts: list[str],
                           labels: "np.ndarray",
                           top_n: int = DEFAULT_TOP_N_KEYWORDS
                           ) -> tuple[dict[int, list[str]], dict[int, str]]:
    """
    For each cluster, find ``top_n`` representative keywords using TF-IDF
    computed across the cluster's documents vs. the whole corpus.

    Returns
    -------
    keywords : dict[int, list[str]]
        ``cluster_id -> list of top_n keywords`` (lowercase, no stopwords).
    labels_map : dict[int, str]
        ``cluster_id -> short human label`` (the top keyword, capitalized).
    """
    _require({"np": "numpy"}, "extracting keywords")
    from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore

    if not texts:
        return {}, {}

    # Build one "document" per cluster by concatenating its members.
    cluster_ids = sorted(set(int(x) for x in np.unique(labels)))  # type: ignore[union-attr]
    cluster_docs: dict[int, str] = {}
    for cid in cluster_ids:
        members = [t for t, lab in zip(texts, labels) if int(lab) == cid]
        cluster_docs[cid] = " \n ".join(members)

    # TF-IDF over the cluster-level documents. ``max_features`` keeps the
    # vocabulary tractable for very large corpora.
    vectorizer = TfidfVectorizer(
        stop_words="english",
        ngram_range=(1, 1),
        max_features=20000,
        sublinear_tf=True,
    )
    tfidf = vectorizer.fit_transform(list(cluster_docs.values()))
    feature_names = vectorizer.get_feature_names_out()

    keywords: dict[int, list[str]] = {}
    labels_map: dict[int, str] = {}
    for row, cid in zip(tfidf.toarray(), cluster_docs.keys()):
        # Top ``top_n`` indices by tf-idf weight.
        top_idx = row.argsort()[::-1][:top_n]
        words = [str(feature_names[i]) for i in top_idx if row[i] > 0]
        keywords[cid] = words
        # Label = capitalized first keyword, or "Misc" if empty.
        if words:
            labels_map[cid] = words[0].capitalize()
        else:
            labels_map[cid] = "Misc"
    return keywords, labels_map


# ---------------------------------------------------------------------------
# 6. Color palette
# ---------------------------------------------------------------------------
# A curated palette of distinct, vibrant colors. Deliberately avoids pure
# blue/indigo dominance so the galaxy doesn't look like a generic "tech demo".
# Each entry is a hex string (lowercase, with leading '#').
_PALETTE: list[str] = [
    "#22d3ee",  # cyan
    "#34d399",  # emerald
    "#f59e0b",  # amber
    "#fb7185",  # rose
    "#a78bfa",  # violet
    "#fb923c",  # orange
    "#2dd4bf",  # teal
    "#f472b6",  # pink
    "#a3e635",  # lime
    "#e879f9",  # fuchsia
    "#facc15",  # yellow
    "#4ade80",  # green
    "#f87171",  # red-400
    "#38bdf8",  # sky
    "#c084fc",  # purple-400
    "#fdba74",  # orange-300
    "#67e8f9",  # cyan-300
    "#fca5a5",  # red-300
    "#86efac",  # green-300
    "#fcd34d",  # amber-300
    "#d8b4fe",  # purple-300
    "#f9a8d4",  # pink-300
    "#5eead4",  # teal-300
    "#bef264",  # lime-300
]


def assign_colors(n_clusters: int) -> list[str]:
    """
    Return ``n_clusters`` distinct hex colors, cycling through the curated
    palette. If we need more colors than the palette has, we deterministically
    generate extra shades by rotating hue so the result stays reproducible.
    """
    if n_clusters <= 0:
        return []
    if n_clusters <= len(_PALETTE):
        return _PALETTE[:n_clusters]

    # Need more colors than the palette holds — generate extras via HSV rotation.
    colors = list(_PALETTE)
    base_hues = [i * (360 / 24) for i in range(24)]  # spread evenly
    extra_needed = n_clusters - len(_PALETTE)
    for i in range(extra_needed):
        # Walk through hues with a small offset to avoid landing on an
        # existing palette color.
        h = (base_hues[i % 24] + 7.5) % 360
        s = 0.75
        v = 0.95
        colors.append(_hsv_to_hex(h, s, v))
    return colors


def _hsv_to_hex(h: float, s: float, v: float) -> str:
    """Convert HSV (h in degrees, s/v in [0,1]) to an ``#rrggbb`` hex string."""
    import colorsys
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360.0, s, v)
    return "#{:02x}{:02x}{:02x}".format(
        int(round(r * 255)), int(round(g * 255)), int(round(b * 255))
    )


# ---------------------------------------------------------------------------
# 7. Assemble final JSON
# ---------------------------------------------------------------------------
def build_cosmos_json(chunks: list[dict],
                      coords: "np.ndarray",
                      labels: "np.ndarray",
                      keywords: dict[int, list[str]],
                      cluster_labels: dict[int, str],
                      colors: list[str],
                      source: str = "chat-exports") -> dict:
    """
    Assemble the full cosmos-data dict that matches the project data contract.

    Each chunk becomes a "node" with 3-D coordinates, a cluster id, and
    metadata. Each cluster becomes an entry in ``clusters`` with a label,
    keywords, color, and member count.
    """
    _require({"np": "numpy"}, "building JSON")

    # ---- date range ---------------------------------------------------
    timestamps: list[str] = [
        c["timestamp"] for c in chunks
        if c.get("timestamp")
    ]
    timestamps.sort()
    date_range: dict[str, Optional[str]] = {"start": None, "end": None}
    if timestamps:
        date_range = {"start": timestamps[0], "end": timestamps[-1]}

    # ---- clusters summary --------------------------------------------
    n_clusters = len(colors)
    cluster_counts: dict[int, int] = {i: 0 for i in range(n_clusters)}
    for lab in labels:
        cid = int(lab)
        if cid in cluster_counts:
            cluster_counts[cid] += 1
        else:
            # Safety net: should not happen after cluster_embeddings, but
            # be defensive in case a caller passed in custom labels.
            cluster_counts.setdefault(cid, 0)
            cluster_counts[cid] += 1

    clusters_out: list[dict] = []
    for cid in range(max(n_clusters, max(cluster_counts, default=-1) + 1)):
        clusters_out.append({
            "id": cid,
            "label": cluster_labels.get(cid, "Misc"),
            "keywords": keywords.get(cid, []),
            "color": colors[cid] if cid < len(colors) else "#9ca3af",
            "count": cluster_counts.get(cid, 0),
        })

    # ---- nodes --------------------------------------------------------
    nodes_out: list[dict] = []
    for i, chunk in enumerate(chunks):
        text = chunk.get("text", "")
        snippet = text[:150].replace("\n", " ").strip()
        if len(text) > 150:
            snippet += "…"
        node = {
            "id": i,
            "x": float(coords[i, 0]),
            "y": float(coords[i, 1]),
            "z": float(coords[i, 2]),
            "clusterId": int(labels[i]),
            "title": chunk.get("title") or _first_words_fallback(text),
            "snippet": snippet,
            "fullText": text,
            "role": chunk.get("role", "user"),
            "timestamp": chunk.get("timestamp"),
            "wordCount": int(chunk.get("word_count", len(text.split()))),
            "source": chunk.get("source", source),
        }
        nodes_out.append(node)

    # ---- top-level metadata ------------------------------------------
    payload = {
        "metadata": {
            "totalNodes": len(nodes_out),
            "totalClusters": len(clusters_out),
            "generatedAt": datetime.now(timezone.utc)
                            .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": source,
            "dateRange": date_range,
        },
        "clusters": clusters_out,
        "nodes": nodes_out,
    }
    return payload


def _first_words_fallback(text: str, n: int = 8) -> str:
    """Tiny helper used when a chunk has no stored ``title``."""
    words = text.split()
    if not words:
        return ""
    head = " ".join(words[:n])
    return head + ("…" if len(words) > n else "")


# ---------------------------------------------------------------------------
# 8. Save
# ---------------------------------------------------------------------------
def save_json(data: dict, path: str | Path) -> None:
    """
    Write the cosmos-data dict to ``path`` as UTF-8 JSON.

    ``ensure_ascii=False`` keeps emoji and CJK characters readable in the
    file. We use a 2-space indent for human inspection; the file is small
    enough that compactness is not a concern.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    logger.info("Wrote cosmos data to %s", p)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="embed_cluster.py",
        description="ChatCosmos Step 2 — embed, cluster, and project chunks "
                    "to 3-D, writing cosmos-data.json.",
    )
    p.add_argument("--input", "-i", required=True,
                   help="Path to chunks.json (output of ingest.py).")
    p.add_argument("--output", "-o", default="../public/data/cosmos-data.json",
                   help="Output path for cosmos-data.json.")
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"sentence-transformers model name (default: {DEFAULT_MODEL}).")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH,
                   help=f"Encoding batch size (default: {DEFAULT_BATCH}).")
    p.add_argument("--n-neighbors", type=int, default=DEFAULT_N_NEIGHBORS,
                   help=f"UMAP n_neighbors (default: {DEFAULT_N_NEIGHBORS}).")
    p.add_argument("--min-dist", type=float, default=DEFAULT_MIN_DIST,
                   help=f"UMAP min_dist (default: {DEFAULT_MIN_DIST}).")
    p.add_argument("--min-cluster-size", type=int, default=DEFAULT_MIN_CLUSTER_SIZE,
                   help=f"HDBSCAN min_cluster_size (default: {DEFAULT_MIN_CLUSTER_SIZE}).")
    p.add_argument("--source", default="chat-exports",
                   help="Label written to metadata.source.")
    p.add_argument("--verbose", "-v", action="store_true",
                   help="Enable DEBUG-level logging.")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    if args.verbose:
        logger.setLevel(logging.DEBUG)

    # ---- 1. Load chunks ------------------------------------------------
    try:
        chunks = load_chunks(args.input)
    except (FileNotFoundError, ValueError) as exc:
        logger.error("%s", exc)
        return 1
    if not chunks:
        logger.error("No chunks in %s — did ingest.py produce any output?",
                     args.input)
        return 1

    texts = [c.get("text", "") for c in chunks]

    # ---- 2. Embed ------------------------------------------------------
    try:
        emb = compute_embeddings(texts, model_name=args.model,
                                 batch_size=args.batch_size)
    except SystemExit as exc:
        # _require() raises SystemExit with a helpful message.
        logger.error("%s", exc)
        return 1

    # ---- 3. Cluster (on high-dim embeddings — better than 3-D) --------
    try:
        labels, n_clusters = cluster_embeddings(
            emb, min_cluster_size=args.min_cluster_size
        )
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- 4. Reduce to 3-D ---------------------------------------------
    try:
        coords = reduce_to_3d(emb, n_neighbors=args.n_neighbors,
                              min_dist=args.min_dist)
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- 5. Topic keywords --------------------------------------------
    try:
        keywords, cluster_labels = extract_topic_keywords(texts, labels)
    except SystemExit as exc:
        logger.error("%s", exc)
        return 1

    # ---- 6. Colors -----------------------------------------------------
    colors = assign_colors(n_clusters)

    # ---- 7. Assemble & save -------------------------------------------
    payload = build_cosmos_json(
        chunks=chunks,
        coords=coords,
        labels=labels,
        keywords=keywords,
        cluster_labels=cluster_labels,
        colors=colors,
        source=args.source,
    )
    save_json(payload, args.output)

    # ---- Summary -------------------------------------------------------
    md = payload["metadata"]
    print()
    print("=" * 60)
    print("ChatCosmos pipeline complete.")
    print(f"  Nodes:    {md['totalNodes']:>6}")
    print(f"  Clusters: {md['totalClusters']:>6}")
    dr = md["dateRange"]
    print(f"  Date range: {dr.get('start', 'n/a')}  ->  {dr.get('end', 'n/a')}")
    print(f"  Output:   {args.output}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
