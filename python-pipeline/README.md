# ChatCosmos — Python Preprocessing Pipeline

This directory contains the **standalone Python pipeline** that turns exported
AI chat logs into the `cosmos-data.json` file consumed by the ChatCosmos
Next.js frontend (a 3D galaxy visualization of your chat history).

The pipeline is **not** run by the web app. You run it locally on your own
exported chat logs, then point the frontend at the resulting JSON file.

---

## What it does

```
chat exports (.json / .jsonl)
        │
        ▼
┌─────────────────┐      ┌─────────────────────────────────────┐
│   ingest.py     │ ───► │ chunks.json                         │
│   (Step 1)      │      │  flat list of ~500-word chunks      │
└─────────────────┘      └─────────────────────────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────────────┐
                          │   embed_cluster.py   (Step 2)       │
                          │   • sentence-transformers           │
                          │   • UMAP → 3D                        │
                          │   • HDBSCAN clusters                 │
                          │   • TF-IDF topic keywords            │
                          └─────────────────────────────────────┘
                                          │
                                          ▼
                          ┌─────────────────────────────────────┐
                          │  cosmos-data.json                   │
                          │  (consumed by the Next.js frontend) │
                          └─────────────────────────────────────┘
```

1. **Ingest** (`ingest.py`): recursively walks an input directory, parses
   each chat-export file, normalizes messages into a uniform shape, and
   chunks them into ~500-word passages (starting a new chunk on topic
   shifts detected via >30-min timestamp gaps).
2. **Embed** (`embed_cluster.py`): encodes each chunk with a
   sentence-transformers model. Embeddings are cached on disk keyed by a
   hash of `(model_name, texts)`, so re-runs after parameter tweaks are
   fast.
3. **Cluster**: HDBSCAN groups semantically similar chunks; noise points
   (label `-1`) are reassigned to their nearest cluster centroid so every
   node ends up colored.
4. **Project**: UMAP reduces the high-dimensional embeddings to 3-D, then
   we rescale to roughly `[-50, 50]` to fit the Three.js scene.
5. **Export**: per-cluster TF-IDF keywords become cluster labels, a
   curated palette assigns distinct colors, and everything is written to
   `cosmos-data.json` matching the data contract documented in the
   project root.

---

## Prerequisites

- **Python 3.10+** (3.12 recommended)
- ~2 GB free disk for the sentence-transformers model cache
- CPU is fine; GPU is faster but not required

Install dependencies:

```bash
cd python-pipeline
pip install -r requirements.txt
```

> **Note**: `sentence-transformers` pulls in PyTorch. On a CPU-only box
> this is the default install. If you have a CUDA GPU and want GPU
> acceleration, install the matching PyTorch wheel first
> (see <https://pytorch.org/get-started/locally/>), then run the
> `pip install` above.

---

## Quick start

```bash
cd python-pipeline

# Run end-to-end on the bundled sample data:
python run_pipeline.py \
    --input ./sample_data \
    --output ../public/data/cosmos-data.json
```

The first run will:

1. Download the `all-MiniLM-L6-v2` model (~80 MB) on first use.
2. Write intermediate chunks to `.cache/chunks.json`.
3. Cache embeddings to `.cache/embeddings-*.npy`.
4. Write the final `cosmos-data.json` to the path you specify.

Subsequent runs reuse the caches — re-running with different
`--min-cluster-size` or `--max-words` is fast.

### Pointing your own chat exports at it

```bash
python run_pipeline.py \
    --input /path/to/your/chat-exports \
    --output ../public/data/cosmos-data.json
```

The `--input` directory may contain any mix of `.json` and `.jsonl` files
in any of the supported formats below.

---

## Running the steps individually

You usually want `run_pipeline.py`, but the two steps are independently
runnable for debugging:

```bash
# Step 1 only — produces chunks.json
python ingest.py --input ./sample_data --output chunks.json

# Step 2 only — reads chunks.json, produces cosmos-data.json
python embed_cluster.py \
    --input chunks.json \
    --output ../public/data/cosmos-data.json \
    --min-cluster-size 5
```

---

## Supported export formats

The parser auto-detects the format per file. A single directory (or even
a single file) may contain a mix.

| Format                                  | Detection cue                                   |
| --------------------------------------- | ----------------------------------------------- |
| OpenAI / ChatGPT `conversations.json`   | Top-level list whose first item has `mapping`   |
| Generic `{ "messages": [...] }`         | Single conversation, one messages array         |
| Generic `{ "conversations": [...] }`    | Wrapper with a list of conversation objects     |
| Generic `{ "chats": [...] }` (Claude)   | Wrapper with `chats` key                         |
| JSONL                                   | `.jsonl` extension; one JSON object per line    |

### Per-message field name flexibility

Messages may use any of these conventions; the parser picks whichever is
present:

| Concept    | Accepted field names                                  |
| ---------- | ----------------------------------------------------- |
| Role       | `role` / `sender` / `author` (string or `{role: …}`)  |
| Content    | `content` (string, `{parts:[…]}`, or list of blocks), `text`, `parts`, `body` |
| Timestamp  | `timestamp` / `created_at` / `create_time` / `time` / `date` — accepts ISO strings or epoch seconds/ms |

### Robustness features

- **Missing timestamps** are inferred from neighbours (1-minute steps
  forward from the previous known timestamp, or backward from the next).
- **Empty content** messages are dropped silently.
- **Malformed JSON lines** in `.jsonl` files are skipped with a warning.
- **Missing optional dependencies** produce a helpful install hint
  instead of a stack trace.
- **Near-duplicate chunks** (same normalized text) are deduplicated
  across the whole input set.

---

## CLI reference

### `run_pipeline.py`

| Flag                   | Default                              | Description                              |
| ---------------------- | ------------------------------------ | ---------------------------------------- |
| `--input / -i`         | (required)                           | Directory containing chat exports        |
| `--output / -o`        | `../public/data/cosmos-data.json`    | Final JSON output path                   |
| `--max-words`          | `500`                                | Target chunk size in words               |
| `--min-cluster-size`   | `15`                                 | HDBSCAN `min_cluster_size`               |
| `--embedding-model`    | `all-MiniLM-L6-v2`                   | sentence-transformers model name         |
| `--chunks-cache`       | `.cache/chunks.json`                 | Intermediate chunks cache path           |
| `--no-cache`           | off                                  | Force re-ingest                          |
| `--verbose / -v`       | off                                  | DEBUG-level logging                      |

### `ingest.py`

```bash
python ingest.py --input ./sample_data --output chunks.json [--max-words 500]
```

### `embed_cluster.py`

```bash
python embed_cluster.py \
    --input chunks.json \
    --output ../public/data/cosmos-data.json \
    [--model all-MiniLM-L6-v2] \
    [--batch-size 64] \
    [--n-neighbors 15] \
    [--min-dist 0.1] \
    [--min-cluster-size 15]
```

---

## Performance notes (50k+ messages)

The pipeline is designed to handle large exports (50,000+ messages)
comfortably on a laptop.

- **Batched embedding**: sentence-transformers encodes in configurable
  batches (default 64). On CPU, `all-MiniLM-L6-v2` does ~200 chunks/sec,
  so 50k chunks ≈ 4 minutes.
- **On-disk embedding cache**: keyed by a SHA-1 of the model name plus
  all chunk texts. Re-running with no text changes is instant. Editing
  only some chunks still forces a full re-encode (intentional —
  incremental embedding cache invalidation is fragile and not worth the
  complexity for now).
- **UMAP**: `n_neighbors=15` is the default; on very large datasets
  (100k+), raise it to 30–50 for more global structure, at the cost of
  runtime. UMAP on 50k high-dim embeddings is ~2–3 minutes on CPU.
- **HDBSCAN**: roughly linear in the number of points; 50k takes under a
  minute. If you have 200k+ points, consider the `hdbscan` `leaf` cluster
  selection method (`cluster_selection_method='leaf'`) for speed — patch
  it in `embed_cluster.py:cluster_embeddings`.
- **Memory**: peak is roughly `(n_chunks × embedding_dim × 4 bytes)` for
  the embedding matrix, plus UMAP's internal graph. For 50k chunks at
  384-dim that's ~75 MB — comfortable on any modern machine.

If you hit OOM, lower `--batch-size` to 32 or 16.

---

## Pointing the frontend at the output

The Next.js frontend reads `public/data/cosmos-data.json` and serves it
at `/data/cosmos-data.json`. The default `--output` flag of
`run_pipeline.py` writes there directly:

```bash
python run_pipeline.py --input ./sample_data
# writes to ../public/data/cosmos-data.json (relative to this directory)
```

After the file is written, refresh the page in the browser — the galaxy
will re-render with your data.

### Custom output location

If you want to inspect the JSON before serving it:

```bash
python run_pipeline.py --input ./sample_data --output ./my-cosmos.json
cp ./my-cosmos.json ../public/data/cosmos-data.json
```

---

## Output data contract

The output is a single JSON object with this shape (see the project root
for the canonical contract):

```json
{
  "metadata": {
    "totalNodes": 4000,
    "totalClusters": 18,
    "generatedAt": "2025-01-15T12:00:00Z",
    "source": "chat-exports",
    "dateRange": { "start": "2024-01-01T00:00:00Z", "end": "2025-01-01T00:00:00Z" }
  },
  "clusters": [
    { "id": 0, "label": "Programming", "keywords": ["react","python","debug"], "color": "#22d3ee", "count": 312 }
  ],
  "nodes": [
    {
      "id": 0,
      "x": 12.3, "y": -4.5, "z": 8.1,
      "clusterId": 0,
      "title": "React useEffect cleanup",
      "snippet": "How do I properly clean up...",
      "fullText": "User: How do I properly clean up...\nAssistant: You should return...",
      "role": "user",
      "timestamp": "2024-03-15T10:30:00Z",
      "wordCount": 42,
      "source": "chatgpt-export"
    }
  ]
}
```

---

## Repository layout

```
python-pipeline/
├── README.md                     ← you are here
├── requirements.txt
├── ingest.py                     ← Step 1: parse + chunk
├── embed_cluster.py              ← Step 2: embed + cluster + project + export
├── run_pipeline.py               ← Orchestrator (run both steps end-to-end)
├── sample_data/
│   └── sample_chats.json         ← Messy multi-format test fixture (~40 messages)
└── .cache/                       ← auto-created on first run (embeddings cache)
```

---

## Troubleshooting

**`Missing dependency 'hdbscan' for clustering`**
You didn't install the requirements. Run `pip install -r requirements.txt`.

**`No clusters found; assigning all points to a single misc cluster`**
Either your input is too small (try `--min-cluster-size 3`) or all chunks
are too similar. Try a larger `--max-words` to get more text per chunk.

**Empty `clusters` / all nodes in one color**
Check that `chunks.json` actually contains diverse text. Run
`python ingest.py -i ./sample_data -v` with verbose logging to see
what's being parsed.

**The galaxy is too dense / too sparse**
Adjust `--min-cluster-size` (lower = more, smaller clusters) and
`--n-neighbors` (higher = more global structure). You may also want to
tweak `SCENE_RADIUS` in `embed_cluster.py` to taste.
