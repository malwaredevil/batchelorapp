---
name: Merge source apps (pottery + quilting) architecture
description: Non-obvious facts about the two source repos being merged into batchelorapp
---

# Source apps: malwaredevil/pottery + malwaredevil/quilting

Both are React+Vite SPAs being merged into this monorepo. Key non-obvious facts:

- **Quilting's frontend artifact dir is also named `artifacts/pottery/`** (it was forked
  from pottery). Don't assume dir name == app name when reading the quilting repo.
- **Both apps share a byte-identical theme** (`src/index.css`, "Field Guide Palette"):
  Inter font, primary deep navy `#1B3A5C` (hsl 212 55% 23%), slate light bg `#f8fafc`,
  warm-brown dark mode, shadcn/ui, radius 0.5rem. The merged app should adopt this as-is.
- **Quilting pioneered a feature-registry plugin pattern** (`src/features/registry.ts` +
  `src/features/index.ts`): `registerFeature({id, nav:{group,href,label,icon,order}, contextActions})`.
  Nav groups: collection | shopping | design | settings. This is the natural basis for
  per-app feature decoupling in the merge.
- **Stack (both):** wouter routing, TanStack Query, AuthProvider + AppShell, shadcn/ui.
  Auth pages (login/forgot-password/reset-password) are near-identical across apps.
- **Compare feature = "Do I own this?"** — photo → AI visual-similarity search over the
  collection. MUST stay scoped: pottery→pottery_items, quilting→quilting_fabrics. Never cross.
- **AI gap:** quilting has visual_embedding (1024) + Voyage/Jina/OpenRouter; pottery only
  has text embedding (1536). Uplift = port quilting's AI pipeline to pottery additively.
