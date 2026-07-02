# 09 — Implementation Notes

Operational specifics: algorithms, recipes, config, and seed data that the other docs
assume. Everything here is self-contained — no external references needed.

## Dev environment

`compose.yaml` services:

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: storyweave }
    ports: ["5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
volumes: { dbdata: {}, miniodata: {} }
```

- `bun dev` = `concurrently "next dev" "bun --watch worker/index.ts"` — one command,
  both processes, hot reload. Worker and app read the same `.env`.
- Required env (only these block boot):

```
DATABASE_URL=postgres://postgres:dev@localhost:5432/storyweave
S3_ENDPOINT=http://localhost:9000    S3_KEY=...  S3_SECRET=...  S3_BUCKET=storyweave
OPENROUTER_API_KEY=...        # or OPENAI_API_KEY — one LLM key
IMAGE_API_KEY=...             # key for the chosen image provider
```

Optional: `GROQ_API_KEY` (fast transcription), per-provider overrides. Provider/model
selection lives in DB settings, not env — changing models never requires a restart.

- Migrations: plain SQL files in `packages/db/migrations/`, applied by a tiny runner on
  app/worker boot (advisory-lock guarded). CI runs `drizzle-kit check` to assert the
  Drizzle schema matches migrations.
- `bun test` runs core+engine unit tests with `FakeAdapters` (canned LLM fixtures from
  JSON files; image gen returns deterministic labeled PNGs via sharp SVG rasterization).

## Job queue implementation

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  chapter_id uuid,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz,
  error text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim ON jobs (status, run_after) WHERE status = 'queued';
CREATE UNIQUE INDEX jobs_one_active ON jobs (chapter_id, stage)
  WHERE status IN ('queued','running');   -- dedupe: one active job per (chapter, stage)
```

Worker loop (N=4 concurrent loops in one process):

```
claim:  UPDATE jobs SET status='running', attempt=attempt+1, heartbeat_at=now()
        WHERE id = (SELECT id FROM jobs WHERE status='queued' AND run_after<=now()
                    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING *;
run:    stage fn with AbortSignal; heartbeat UPDATE every 15s from a timer.
done:   status='done'; advance chapter state machine; NOTIFY events channel.
fail:   retryable && attempt<max → status='queued', run_after=now()+2^attempt*30s
        else → status='failed', chapters.stage_error=error, NOTIFY.
reaper: every 60s: running jobs with heartbeat_at < now()-90s → back to 'queued'.
```

Rate limiting is inside adapters (token-bucket per provider), so queue concurrency
stays simple.

## Timing math (`core/timing.ts`)

The sync spine, pure functions:

```
panelWindow(panel): beat = panel.beat
  segs = segments[beat.segmentStart .. beat.segmentEnd]
  window = [segs.first.startSec, segs.last.endSec]
  Multiple panels per beat: split the window proportionally to each panel's
  dialogue character count (min 1.5s per panel; equal split if no dialogue).
```

Invariants (unit-tested): windows are monotonic in reading order, non-overlapping,
gap-free within a scene (panel N's end = panel N+1's start), and the last panel's end
equals the chapter audio duration ± last segment slack.

## Bubble auto-placement (`engine/letter.ts`)

1. VLM face-locate → face bboxes (normalized).
2. Candidate anchor regions per bubble, tried in order: above speaker's head, upper-left
   quadrant, upper-right, lower third. First region with (a) no face-bbox intersection,
   (b) no placed-bubble intersection, (c) fits within panel with 4% margin, wins.
3. Bubble size from text: measure with the style pack font at base size, wrap to
   ≤ 28 chars/line, bbox = text block + padding; shrink font one step (max two) if the
   bubble would exceed 30% of panel area.
4. Tail: from bubble edge nearest the speaker's face center; omit tail for narration
   (rect box, top edge) and sfx (no container, styled text).
5. Reading order: bubbles sorted by dialogue position; enforce top-left→bottom-right
   flow by nudging earlier bubbles up/left when order and geometry disagree.
6. Persist as `bubbles` rows with `autoPlaced: true`; any user drag flips it false and
   the row is never auto-moved again.

## Page composition (`engine/compose.ts`)

- Page canvas 2048×3072 px (2:3). Panel bbox → pixel rect minus gutter (12px). sharp:
  resize render to cover the rect, extract-center-crop, composite. 4px black border per
  panel (style packs can override border width/color).
- Two outputs per page: clean composite (reader zoom + export base) and, at export time
  only, a bubble-burned variant (SVG overlay rasterized at page resolution, composited).
- `content_hash = sha256(renderIds + layout + bubbleRows + stylePackId)` → skip if
  unchanged.

## Export recipes (`engine/publish.ts`)

- **CBZ**: zip of bubble-burned page PNGs, `page-001.png` naming, `ComicInfo.xml` with
  title/chapter metadata.
- **PDF**: pdf-lib, one page per composed image, embedded at native px (1px = 1pt).
- **MP4** (per panel segment → concat):

```
# per-panel segment: Ken Burns from motion table
ffmpeg -loop 1 -i panel.png -t {dur} \
  -filter_complex "[0]scale=2560:-2,zoompan=z='{zexpr}':x='{xexpr}':y='{yexpr}'\
  :d={dur*fps}:s=1920x1080:fps=30,format=yuv420p" -c:v libx264 -preset fast seg_N.mp4
# concat (stream copy) + audio mux
ffmpeg -f concat -safe 0 -i list.txt -c copy video.mp4
ffmpeg -i video.mp4 -i chapter_audio.m4a -c:v copy -c:a aac -shortest out.mp4
```

Motion table (camera → motion): `close_up→slow zoom-in (1.0→1.08)`, `wide/establishing→
slow pan`, `splash→zoom-out (1.1→1.0)`, default static. Bubbles: rasterize the panel's
SVG overlay onto the PNG before the segment encode. Captions: WebVTT from dialogue
windows, muxed as subtitle track.

- **m4b chapter split** (ingest): `ffprobe -v quiet -print_format json -show_chapters in.m4b`
  → per chapter `ffmpeg -i in.m4b -ss {start} -to {end} -c copy -map 0:a ch.m4a`.

## LLM wrapper (defense-in-depth, one place)

`adapters/llm.ts` — the ONLY path for structured calls:

1. Call provider with JSON mode + zod-to-JSON-schema.
2. Parse fail → one repair attempt: re-send with the parse error + raw output,
   "return corrected JSON only".
3. Degenerate check: schema-specific predicate passed by the caller (e.g. "≥1 scene,
   every beat has segment range"). Fail → retry once with `tier: "strong"` escalation.
4. Still failing → `{retryable: false}` with the last error; job parks as failed.
5. Timeout 120s per call; usage recorded on every attempt including failures.

Chunking policy for script stage: ~3k words per call, chunk boundary snapped to segment
gaps > 1.5s (likely paragraph breaks); rolling summary ≤ 300 words regenerated (fast
tier) after each chunk.

## Layout template library (seed data)

~25 templates seeded as JSON, tagged for the storyboard LLM. Representative set:

| id | slots | tags |
|---|---|---|
| splash | 1 full page | reveal, climax, establishing |
| grid-2x2 | 4 equal | conversation, steady |
| grid-3x3 | 9 equal | montage, rapid |
| rows-3 | 3 full-width bands | action progression |
| tall-left-2r | 1 tall left + 2 stacked right | entrance, reaction |
| wide-top-3b | 1 wide top + 3 bottom | establish-then-converse |
| big-bottom | 2 top + 1 large bottom | build-to-impact |
| asym-5 | 2+1+2 offset rows | busy dialogue |
| vertical-3 | 3 tall columns | simultaneity, phone-friendly |

Slot bboxes normalized to 0..1 at 2:3 page ratio; each slot's aspect is precomputed and
drives the render aspect for its panel.

## Evals (fixture harness, wired M2)

`bun run evals` against the checked-in fixture book (public-domain novella + one narrated
chapter of audio):

| Metric | Method | Gate |
|---|---|---|
| single-panel rate | VLM judge over rendered fixtures | ≥95% |
| text-free rate | VLM judge | ≥98% |
| identity consistency | embedding/VLM match of character crops vs cast ref across panels | ≥90% |
| dialogue attribution | scripted check vs hand-labeled fixture script | ≥85% high-confidence correct |
| timing sanity | invariants from core/timing.ts on real chapter | 100% |
| layout validity | validator over storyboard output | 100% |

Run on demand + on prompt-version changes (08 §protocol). Not in per-PR CI (costs money);
CI runs the free subset (timing, layout, unit tests) always.

## Security / misc

- Presigned URLs for all media (short TTL for private, long for published manifests).
- Reader share links: unguessable slug per chapter, revocable, read-only manifest access.
- Upload limits: 2GB per file, mime-sniffed server-side; audio duration probed before
  accepting (reject > 30h).
- Budget cap: `projects.settings.budgetUsd` — render/cast stages check
  `sum(usage_events)` before each provider call and park the job with a
  "budget exceeded" error the UI turns into a raise-budget prompt.
