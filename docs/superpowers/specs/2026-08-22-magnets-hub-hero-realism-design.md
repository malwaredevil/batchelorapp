# Magnets Hub Hero Realism Design

## Goal

Replace the Magnets hub card's flat illustrated artwork with a realistic, wide
photographic image that matches the neighboring Office, Travels, and Quilting
cards while making the module's subject immediately recognizable.

## Visual direction

- Scene: a colorful refrigerator door covered with collected souvenir,
  tchotchke, promotional, and novelty magnets.
- Treatment: warm editorial still-life photography with natural kitchen light,
  believable plastic and metal textures, and restrained depth of field.
- Composition: landscape crop with the densest magnet variety toward the upper
  and right areas; keep the lower-left area visually quiet and moderately dark
  so the existing white card title remains readable.
- Content: no generated UI labels, logos, or title text inside the image.
- Tone: charmingly eclectic and slightly tacky, but still polished enough to
  belong beside the existing household collection cards.

## Implementation

Generate one landscape PNG in the hub's existing public image directory and
change only the Magnets card's image path from the SVG to the new PNG. Preserve
the existing app registry, card component, dimensions, labels, links, stats,
and module behavior.

## Acceptance criteria

1. Magnets uses the new raster photo on the hub.
2. The image reads as a real refrigerator-door magnet collection at card size.
3. The white “Magnets” overlay remains legible in the existing card crop.
4. Neighboring hub cards are unchanged.
5. The hub still builds and renders at desktop and narrow/mobile widths.
