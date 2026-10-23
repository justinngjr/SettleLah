import "server-only";

import { createHash } from "node:crypto";

/** One label/value line on an action card ("Total" / "$48.60"). */
export interface PreviewRow {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}

/** One per-person line on a split card. */
export interface PreviewShare {
  readonly participantId: string;
  readonly name: string;
  readonly amount: string;
  readonly paysNothing: boolean;
}

/**
 * What the host sees on an action card. It is computed by the tool's
 * `preview`, stored with the pending action, and recomputed on approval: if
 * the current data would render a different card, the host must approve again.
 * Only strings and booleans: the UI never does arithmetic on a preview.
 */
export interface ActionPreview {
  /** e.g. "Save split: Dinner at Noodle Place" */
  readonly title: string;
  /** One sentence the model did not write: what will happen when approved. */
  readonly summary: string;
  readonly rows: readonly PreviewRow[];
  readonly shares?: readonly PreviewShare[];
  readonly warnings?: readonly string[];
  /** The host app screen that shows the affected data, e.g. "/app/friends/<id>". */
  readonly openInApp: string | null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** sha256 over the canonical (key-sorted) JSON of a preview. */
export function previewHash(preview: ActionPreview): string {
  return createHash("sha256").update(JSON.stringify(canonical(preview))).digest("hex");
}
