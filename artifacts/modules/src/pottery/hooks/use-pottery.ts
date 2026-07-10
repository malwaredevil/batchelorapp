// Multipart/form-data upload hooks moved to @workspace/api-client-react so
// they follow the same shared-lib pattern as the travels upload hooks
// (uploadTripPhoto/useUploadTripPhoto) instead of hand-rolled fetch() calls
// living directly in the artifact. Re-exported here to avoid churning every
// call site's import path.
export {
  useUploadPottery,
  useUploadCompare,
  useUploadPotteryImage,
} from "@workspace/api-client-react";
