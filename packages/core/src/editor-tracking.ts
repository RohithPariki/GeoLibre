import type { Feature, FeatureCollection } from "geojson";
import type { EditorTrackingConfig } from "./types";

/** Default field names for maintained editor tracking columns. */
export const DEFAULT_EDITOR_TRACKING_CONFIG: Required<EditorTrackingConfig> = {
  enabled: false,
  createdByField: "created_by",
  createdAtField: "created_at",
  editedByField: "edited_by",
  editedAtField: "edited_at",
};

/**
 * Options for editor tracking stamping functions.
 */
export interface EditorTrackingStampOptions {
  /** Optional custom editor tracking field configuration. */
  config?: EditorTrackingConfig;
  /** Identity string of the author/editor (e.g. username, email, or client ID). Defaults to "local-user". */
  userIdentity?: string;
  /** ISO timestamp override for deterministic testing or batch operations. Defaults to `new Date().toISOString()`. */
  timestamp?: string;
}

/**
 * Fully resolve an {@link EditorTrackingConfig} with fallback default field names.
 */
export function resolveEditorTrackingConfig(
  config?: EditorTrackingConfig
): Required<EditorTrackingConfig> {
  return {
    enabled: config?.enabled ?? DEFAULT_EDITOR_TRACKING_CONFIG.enabled,
    createdByField: config?.createdByField || DEFAULT_EDITOR_TRACKING_CONFIG.createdByField,
    createdAtField: config?.createdAtField || DEFAULT_EDITOR_TRACKING_CONFIG.createdAtField,
    editedByField: config?.editedByField || DEFAULT_EDITOR_TRACKING_CONFIG.editedByField,
    editedAtField: config?.editedAtField || DEFAULT_EDITOR_TRACKING_CONFIG.editedAtField,
  };
}

/**
 * Check whether a field name corresponds to one of the maintained editor tracking columns.
 */
export function isMaintainedEditorTrackingField(
  fieldName: string,
  config?: EditorTrackingConfig
): boolean {
  const resolved = resolveEditorTrackingConfig(config);
  return (
    fieldName === resolved.createdByField ||
    fieldName === resolved.createdAtField ||
    fieldName === resolved.editedByField ||
    fieldName === resolved.editedAtField
  );
}

/**
 * Ensure all configured editor tracking field names are included in a field list.
 */
export function ensureEditorTrackingFields(
  fields: string[],
  config?: EditorTrackingConfig
): string[] {
  const resolved = resolveEditorTrackingConfig(config);
  if (!resolved.enabled) {
    return fields;
  }
  const result = [...fields];
  const trackingFields = [
    resolved.createdByField,
    resolved.createdAtField,
    resolved.editedByField,
    resolved.editedAtField,
  ];
  for (const tf of trackingFields) {
    if (!result.includes(tf)) {
      result.push(tf);
    }
  }
  return result;
}

/**
 * Stamp editor tracking metadata onto a feature's properties object.
 *
 * On `"create"`:
 * Sets `created_by` and `created_at` (if not already set), as well as `edited_by` and `edited_at`.
 *
 * On `"update"`:
 * Sets or updates `edited_by` and `edited_at`. Preserves existing `created_by` and `created_at`.
 */
export function stampFeaturePropertiesEditorTracking(
  properties: Record<string, unknown> | null | undefined,
  action: "create" | "update",
  options?: EditorTrackingStampOptions
): Record<string, unknown> {
  const resolved = resolveEditorTrackingConfig(options?.config);
  if (!resolved.enabled) {
    return properties ? { ...properties } : {};
  }

  const result: Record<string, unknown> = properties ? { ...properties } : {};
  const now = options?.timestamp ?? new Date().toISOString();
  const actor = options?.userIdentity || "local-user";

  if (action === "create") {
    if (result[resolved.createdByField] === undefined || result[resolved.createdByField] === null) {
      result[resolved.createdByField] = actor;
    }
    if (result[resolved.createdAtField] === undefined || result[resolved.createdAtField] === null) {
      result[resolved.createdAtField] = now;
    }
  }

  result[resolved.editedByField] = actor;
  result[resolved.editedAtField] = now;

  return result;
}

/**
 * Stamp editor tracking metadata onto a GeoJSON {@link Feature}.
 */
export function stampFeatureEditorTracking<T extends Feature>(
  feature: T,
  action: "create" | "update",
  options?: EditorTrackingStampOptions
): T {
  const resolved = resolveEditorTrackingConfig(options?.config);
  if (!resolved.enabled) {
    return feature;
  }

  return {
    ...feature,
    properties: stampFeaturePropertiesEditorTracking(feature.properties, action, options),
  };
}

/**
 * Stamp editor tracking metadata onto all features in a {@link FeatureCollection}.
 */
export function stampFeatureCollectionEditorTracking(
  collection: FeatureCollection,
  action: "create" | "update",
  options?: EditorTrackingStampOptions
): FeatureCollection {
  const resolved = resolveEditorTrackingConfig(options?.config);
  if (!resolved.enabled) {
    return collection;
  }

  return {
    ...collection,
    features: collection.features.map((feat) =>
      stampFeatureEditorTracking(feat, action, options)
    ),
  };
}
