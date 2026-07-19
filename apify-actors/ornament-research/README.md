# Hallmark Ornament Research Actor

Looks up Hallmark ornament details from `hallmark.com` using a headless browser (Playwright/Chrome), which is required because Hallmark's product search is JavaScript-rendered.

## What it extracts

- **Name** — official Hallmark ornament name
- **Hallmark SKU** — catalog number (e.g. `QXI7404`)
- **Series name** — e.g. "Toymaker Santa Keepsake Ornament"
- **Sequence number** — e.g. 26 ("26th in the series")
- **Artist** — designer name
- **Original retail price** — Hallmark MSRP
- **Images** — up to 4 product image URLs
- **Confidence score** — 0–1 based on how well the result matches the input

## Input

| Field         | Type   | Description                                                            |
| ------------- | ------ | ---------------------------------------------------------------------- |
| `barcode`     | string | UPC barcode (for reference only, not used for search)                  |
| `hallmarkSku` | string | Hallmark catalog number — **most precise search key** (e.g. `QXI7404`) |
| `name`        | string | Ornament name — used as fallback if no SKU                             |
| `year`        | number | Release year — appended to name search                                 |

Tip: Extract the Hallmark SKU from the UPCitemdb `model` field. For example, model `9702499QXI7404` → SKU `QXI7404`.

## Output (one item in dataset)

```json
{
  "found": true,
  "hallmarkSku": "QXI7404",
  "name": "Star Wars: The Mandalorian Wielding the Darksaber Ornament",
  "brand": "Hallmark",
  "seriesName": null,
  "sequenceNumber": null,
  "year": 2024,
  "artist": "Orville Wilson",
  "originalRetailPrice": 24.99,
  "hallmarkProductUrl": "https://www.hallmark.com/ornaments/keepsake-ornaments/...",
  "images": ["https://www.hallmark.com/dw/image/..."],
  "description": "...",
  "confidence": 0.85,
  "source": "hallmark.com",
  "scrapedAt": "2026-07-19T..."
}
```

## Integration

This actor is called from the Batchelor API server via `runApifyActor()` in
`artifacts/api-server/src/lib/apify-client.ts`. The actor ID is stored in
`env.hallmarkActorId` (`HALLMARK_ACTOR_ID` environment variable).

## Repo structure

```
apify-actors/ornament-research/
├── .actor/
│   ├── actor.json          ← Apify manifest
│   └── input_schema.json   ← Input schema shown in Apify UI
├── src/
│   └── main.ts             ← Actor entry point (TypeScript)
├── Dockerfile              ← Uses apify/actor-node-playwright-chrome base image
├── package.json
└── tsconfig.json
```

## Development

To run locally (requires Node 22 and `APIFY_IS_AT_HOME` not set):

```bash
cd apify-actors/ornament-research
npm install
npm run build
npm start
```

## Phase 2: eBay valuation

Once an eBay Developer API key is available, a second step will be added after the Hallmark lookup:

1. Search eBay Browse API (`completedItems`) by `hallmarkSku + year`
2. Extract sold price range, median, comparable count
3. Include in the dataset output under `valuation`
