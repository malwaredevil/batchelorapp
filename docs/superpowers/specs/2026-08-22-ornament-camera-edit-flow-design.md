# Ornament camera edit flow

## Goal

When a user captures a photo from the standard Add Ornament page, let them
edit it before it is analyzed. Saving the edited photo creates the ornament
with the existing AI-aware multipart endpoint and opens the new record in edit
mode.

## Decisions

- Camera captures only use the edit-image step. Uploads keep the existing
  behavior of selecting a file into the manual form.
- The shared `@workspace/image-capture` picker owns the camera/editor/retake
  loop so every consumer can opt into the same behavior without duplicating
  camera lifecycle code.
- The existing shared editor controls remain unchanged: crop, rotation,
  horizontal flip, zoom/pan, brightness, contrast, sharpen, and reset.
- `Retake photo` discards the current editor state and reopens the camera.
- The normal ornament create endpoint remains the source of truth for AI
  analysis, image persistence, enrichment, and the primary image.
- The existing bulk camera-add page is intentionally out of scope.

## Failure behavior

The add page displays an AI-analysis progress state after the editor is saved.
If creation fails, the error is shown and the edited file remains in the editor
so the user can retry or retake rather than losing the captured image.

## Success criteria

1. Camera capture opens the existing editor.
2. The editor exposes a Retake photo action that returns to the camera.
3. Uploading a file does not open the editor or auto-submit.
4. Saving an edited camera photo runs the existing AI create flow.
5. The returned ornament is opened at `/ornaments/ornament/:id?edit=1` with the
   edited photo as its primary image.
