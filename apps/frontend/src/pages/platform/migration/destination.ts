import type { MigrationPreview } from "@siskop/types";

/** Where the data goes: a koperasi created from sheet 1, or a registered (empty) one picked by the platform admin. */
export type Destination = "baru" | "ada";

/**
 * The preview was computed for one destination; if the admin has since chosen another, what is on screen
 * describes the wrong koperasi and must be re-checked before anything can be executed.
 */
export function isPreviewStale(preview: MigrationPreview, destination: Destination, tenantId: string | null): boolean {
  if (destination === "baru") return preview.target !== null;
  return !tenantId || preview.target?.tenantId !== tenantId;
}

export function canExecuteMigration(preview: MigrationPreview, destination: Destination, tenantId: string | null): boolean {
  return preview.canExecute && !isPreviewStale(preview, destination, tenantId);
}
