// All implementations now live in ../image. This file is a pure re-export
// facade so the historical ornaments import surface is unchanged.
export {
  sniffImageType,
  toDataUrl,
  stripImageMetadata,
  type SupportedImageType,
  shrinkForAi,
  AI_IMAGE_CONTENT_TYPE,
} from "../image";
