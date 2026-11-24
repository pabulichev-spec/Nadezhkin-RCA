const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
]);

export function isSupportedAiDocumentMime(mimeType?: string) {
  if (!mimeType) return false;
  return SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType.split(";")[0].trim().toLowerCase());
}
