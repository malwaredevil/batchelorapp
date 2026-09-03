# Ornament camera-add editor-first flow

## Goal

Make both collection Add Ornament entry points provide the same first-photo
experience: camera capture opens the image editor immediately, and saving the
edited image runs AI creation before opening the new ornament in edit mode.

## Scope

- The existing `/ornaments/camera-add` page remains the destination for both
  collection Add Ornament buttons.
- The first photo captured from its camera opens the shared image editor.
- The editor exposes a flow-specific `Retake Image` action that returns to the
  camera without creating an ornament.
- Saving the edited first photo calls the existing AI-aware
  `createOrnamentFromImage` endpoint and navigates to the new ornament's edit
  page.
- Existing barcode scanning, gallery uploads, and their current queue behavior
  remain unchanged.
- Additional images are added from the ornament edit page after creation.

## Architecture

The camera-add page will own a small first-photo editing state:

1. Camera capture closes the viewfinder and stores the captured file as the
   pending first photo.
2. The shared `ImageEditor` renders above the page while a first photo is
   pending.
3. `Retake Image` clears the pending file and reopens `CameraModal`.
4. Editor save sends the edited file through the existing create helper,
   invalidates ornament list/stat queries, and navigates to
   `/ornaments/ornament/:id?edit=1`.

The shared editor gets an optional retake-label prop with its current wording
as the default, allowing this flow to use the requested `Retake Image` label
without changing other image-capture consumers.

## Error handling

- While AI creation is running, editor actions are disabled and the existing
  AI progress state is shown.
- If creation fails, the pending edited file remains open in the editor so the
  user can retry or retake it.
- Camera stream cleanup continues to be handled by `CameraModal`.
- Existing queue errors for uploads and barcode operations keep their current
  banners, toasts, and retry behavior.

## Testing

- Add focused tests for the first-photo state transitions: capture opens the
  editor, retake returns to camera, and save uses the edited file.
- Verify create failure keeps the editor open and does not navigate.
- Verify the successful result navigates to the edit route and refreshes list
  and stats queries.
- Run formatting, typecheck, lint, targeted tests, and a mobile-sized browser
  smoke check for both collection Add Ornament entry points.

## Success criteria

1. Tapping either collection Add Ornament entry point and choosing Take Photos
   opens the camera.
2. Capturing a photo immediately opens Edit photo for that capture.
3. The editor shows `Retake Image`; tapping it reopens the camera.
4. Saving the edited photo performs AI creation with the edited file.
5. Successful creation opens the new ornament's edit screen, where details and
   additional images can be managed.
6. Upload and barcode flows continue to work as before.
