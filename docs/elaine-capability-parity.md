# Elaine website capability parity

Generated from the committed OpenAPI specification and the reviewed operation inventory. Do not edit this report by hand; run `pnpm --filter @workspace/scripts run elaine:capability-report`.

## Summary

- Website operations inventoried: 271
- Direct Elaine mappings: 86
- Universal authenticated operation bridge: 128
- Covered by general read tools: 27
- Attachment/camera prerequisites: 19
- Interactive authentication: 10
- Owner/admin operations: 0
- Background/system operations: 0
- Non-user operations: 1
- Planned capability gaps: 0

## Coverage by domain

| Domain          | Website operations | Direct/general coverage | Planned gaps |
| --------------- | -----------------: | ----------------------: | -----------: |
| Block Templates |                  5 |                       5 |            0 |
| auth            |                 12 |                       4 |            0 |
| blocks          |                  7 |                       6 |            0 |
| categories      |                  7 |                       7 |            0 |
| compare         |                  2 |                       2 |            0 |
| config          |                  3 |                       3 |            0 |
| fabrics         |                 15 |                      11 |            0 |
| health          |                  1 |                       0 |            0 |
| hub             |                  4 |                       4 |            0 |
| jobs            |                  5 |                       5 |            0 |
| lab             |                  4 |                       4 |            0 |
| layouts         |                  5 |                       5 |            0 |
| messenger       |                 18 |                      15 |            0 |
| notifications   |                  6 |                       6 |            0 |
| office          |                  4 |                       4 |            0 |
| operations      |                  7 |                       7 |            0 |
| ornaments       |                 29 |                      26 |            0 |
| patterns        |                 16 |                      13 |            0 |
| pottery         |                 28 |                      26 |            0 |
| quilting        |                 17 |                      17 |            0 |
| quilts          |                 13 |                       9 |            0 |
| shopping        |                  7 |                       7 |            0 |
| stats           |                  3 |                       3 |            0 |
| tools           |                  3 |                       3 |            0 |
| travels         |                 45 |                      44 |            0 |
| wishlist        |                  5 |                       5 |            0 |

## Open gaps

Every exclusion has a precise disposition and reason in `website-operation-inventory.json`. Interactive authentication, browser permission, infrastructure, and binary/camera prerequisites remain intentionally explicit rather than silently pretending the operation is supported.

| Operation                     | Endpoint                                       | Domain    | Disposition          | Reason                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------- | --------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addFabricImage`              | POST `/quilting/fabrics/{id}/images`           | fabrics   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `addOrnamentImage`            | POST `/ornaments/items/{id}/images`            | ornaments | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `addPatternImage`             | POST `/quilting/patterns/{id}/images`          | patterns  | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `addPotteryImage`             | POST `/pottery/items/{id}/images`              | pottery   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `addQuiltImage`               | POST `/quilting/quilts/{id}/images`            | quilts    | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `createFabric`                | POST `/quilting/fabrics`                       | fabrics   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `createOrnament`              | POST `/ornaments/items`                        | ornaments | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `createPottery`               | POST `/pottery/items`                          | pottery   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `createQuilt`                 | POST `/quilting/quilts`                        | quilts    | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `extractOrnamentBarcodePhoto` | POST `/ornaments/barcode-photo-lookup`         | ornaments | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getBlockPreviewPng`          | GET `/quilting/blocks/{id}/preview.png`        | blocks    | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getFabricImage`              | GET `/quilting/fabrics/{id}/image`             | fabrics   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getFabricSupplementalImage`  | GET `/quilting/fabrics/{id}/images/{imageId}`  | fabrics   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getPatternImage`             | GET `/quilting/patterns/{id}/image`            | patterns  | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getPatternSupplementalImage` | GET `/quilting/patterns/{id}/images/{imageId}` | patterns  | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getQuiltImage`               | GET `/quilting/quilts/{id}/image`              | quilts    | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `getQuiltSupplementalImage`   | GET `/quilting/quilts/{id}/images/{imageId}`   | quilts    | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `uploadAttachment`            | POST `/messenger/attachments/upload`           | messenger | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
| `uploadTripDocument`          | POST `/travels/trips/{id}/documents`           | travels   | attachment_or_camera | This operation starts with binary upload, camera capture, or a generated binary response. Elaine can reason over chat attachments, but a shared binary-operation service is still required before she can safely execute it. |
