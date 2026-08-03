# Elaine avatar — source formats

Master copies of Elaine's official portrait, kept here so every format is
available the next time a feature needs one (e.g. a video/GIF loading state,
an `<picture>` fallback, or a favicon). Do not delete — regenerate derived
assets from these, don't hand-edit the derived copies.

| File                 | Format     | Dimensions | Notes                                                                                                                                                                          |
| -------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `elaine-avatar.jpg`  | JPEG       | 1254×1254  | Flat still image, smallest file size.                                                                                                                                          |
| `elaine-avatar.gif`  | GIF        | 1254×1254  | Animated version.                                                                                                                                                              |
| `elaine-avatar.webm` | WebM (VP9) | 1254×1254  | Animated version, smaller/higher quality than the GIF — prefer this for any video-tag use, falling back to the GIF only where `<video>` isn't viable.                          |
| `elaine-avatar.svg`  | SVG        | 1254×1254  | Not a true vector — it's the still portrait wrapped in an SVG (base64-embedded raster `<image>`). Treat it as another raster export, not something to hand-edit as vector art. |

The actively-used circular avatar (`lib/elaine-ui/src/assets/elaine-avatar.png`,
consumed by `ElaineAvatar.tsx`) was resized/cropped from `elaine-avatar.jpg`'s
source photo. If Elaine's likeness changes again, replace all files here
first, then regenerate `../elaine-avatar.png` from the new still image.
