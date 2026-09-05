import "server-only";

const PREVIEW_ENV = "PLANME_PROGRESS_UI_PREVIEW";

/** Keeps the unapproved progressive-generation prototype local to development. */
export function isPlanmeProgressPreviewEnabled() {
  return process.env[PREVIEW_ENV]?.trim() === "1";
}
