// Preserve the first input across preview normalization, rotations and repeated
// edits. Weak references avoid retaining photos after their form is closed.
const originals = new WeakMap<File, File>();

export function getOriginalImageFile(file: File): File {
  return originals.get(file) ?? file;
}

export function inheritOriginalImage(edited: File, source: File): File {
  const original = getOriginalImageFile(source);
  if (edited !== original) originals.set(edited, original);
  return edited;
}
