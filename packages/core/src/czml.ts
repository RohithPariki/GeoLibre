import { DEFAULT_LAYER_STYLE, type GeoLibreLayer } from "./types";

/**
 * CZML (Cesium Language) domain models and layer authoring (issue #2290).
 *
 * CZML is a JSON-based format for describing dynamic, time-varying 3D geospatial
 * scenes on the Cesium globe (trajectories, satellites, vehicles, sensor
 * networks, moving entities with orientations and paths). The globe loads CZML
 * natively through `CzmlDataSource`; the 2D map has no equivalent, so CZML
 * layers are badged "3D only" there.
 */

/** `metadata.sourceKind` of a layer that carries or references CZML data. */
export const CZML_SOURCE_KIND = "czml";

/** One CZML packet in a document stream. */
export type CzmlPacket = Record<string, unknown>;

/** Minimal Point sample in CZML. */
export const CZML_SAMPLE_POINT: CzmlPacket[] = [
  {
    id: "document",
    name: "CZML Point Sample",
    version: "1.0",
  },
  {
    id: "point 1",
    name: "Extruded Point",
    position: {
      cartographicDegrees: [-75.59777, 40.03883, 1000],
    },
    point: {
      color: {
        rgba: [255, 128, 0, 255],
      },
      pixelSize: 14,
      outlineColor: {
        rgba: [255, 255, 255, 255],
      },
      outlineWidth: 2,
    },
  },
];

/** Time-dynamic trajectory sample with an orbit track and clock. */
export const CZML_SAMPLE_DYNAMIC: CzmlPacket[] = [
  {
    id: "document",
    name: "CZML Trajectory Sample",
    version: "1.0",
    clock: {
      interval: "2026-09-09T00:00:00Z/2026-09-09T02:00:00Z",
      currentTime: "2026-09-09T00:00:00Z",
      multiplier: 60,
      range: "LOOP_STOP",
    },
  },
  {
    id: "satellite",
    name: "Satellite Track",
    availability: "2026-09-09T00:00:00Z/2026-09-09T02:00:00Z",
    path: {
      material: {
        solidColor: {
          color: {
            rgba: [0, 200, 255, 255],
          },
        },
      },
      width: 2,
      leadTime: 1800,
      trailTime: 1800,
    },
    position: {
      epoch: "2026-09-09T00:00:00Z",
      cartographicDegrees: [
        0, -75, 40, 250000,
        1800, -30, 20, 250000,
        3600, 20, 0, 250000,
        5400, 70, -20, 250000,
        7200, 120, -40, 250000,
      ],
    },
    point: {
      color: {
        rgba: [255, 255, 255, 255],
      },
      pixelSize: 10,
    },
  },
];

/** One-click CZML samples offered in the Add Data dialog. */
export const CZML_QUICK_PICKS: ReadonlyArray<{
  name: string;
  data: CzmlPacket[];
}> = [
  { name: "CZML Point", data: CZML_SAMPLE_POINT },
  { name: "CZML Dynamic Trajectory", data: CZML_SAMPLE_DYNAMIC },
];

/**
 * Parse and validate a CZML payload from a JSON string or raw object.
 * Returns an array of CZML packets or null when the input is malformed.
 */
export function parseCzml(value: unknown): CzmlPacket[] | null {
  if (!value) return null;
  let parsed = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.length > 0 && parsed.every((item) => item && typeof item === "object")
      ? (parsed as CzmlPacket[])
      : null;
  }
  if (parsed && typeof parsed === "object") {
    return [parsed as CzmlPacket];
  }
  return null;
}

/**
 * Whether `layer` represents a CZML dynamic 3D scene.
 */
export function isCzmlLayer(layer: Pick<GeoLibreLayer, "source" | "metadata">): boolean {
  return layer.metadata?.sourceKind === CZML_SOURCE_KIND;
}

/** Extracted CZML source definition for a layer. */
export interface CzmlSource {
  url?: string;
  data?: CzmlPacket[] | string;
}

/**
 * Extract the CZML content and/or URL from a layer, or null if not a CZML layer.
 */
export function czmlSource(
  layer: Pick<GeoLibreLayer, "source" | "metadata">,
): CzmlSource | null {
  if (!isCzmlLayer(layer)) return null;
  const data = (layer.source?.czmlData ?? layer.source?.czml) as CzmlPacket[] | string | undefined;
  const rawUrl = layer.source?.url ?? layer.metadata?.czmlUrl;
  const url = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl.trim() : undefined;
  if (!data && !url) return null;
  return { url, data };
}

/** Generate a unique identifier for a newly created layer. */
function newLayerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Options for constructing a CZML layer.
 */
export interface CzmlLayerOptions {
  /** Optional layer id; defaults to a new UUID. */
  id?: string;
  /** Display name of the layer in the Layers panel. */
  name: string;
  /** Inlined CZML packet array or serialized JSON string. */
  czml?: CzmlPacket[] | string;
  /** Inlined CZML packet array or serialized JSON string (alias for czml). */
  data?: CzmlPacket[] | string;
  /** Remote URL pointing to a .czml document. */
  url?: string;
  /** Local path when loaded from disk. */
  sourcePath?: string;
}

/**
 * Build a typed GeoLibreLayer representing a CZML dynamic scene on the Cesium globe.
 */
export function createCzmlLayer(options: CzmlLayerOptions): GeoLibreLayer {
  const id = options.id ?? newLayerId();
  const data = options.data ?? options.czml;
  const url = options.url?.trim() || undefined;
  const sourcePath = options.sourcePath?.trim() || undefined;

  return {
    id,
    name: options.name,
    type: "3d-tiles",
    ...(sourcePath ? { sourcePath } : {}),
    source: {
      type: "3d-tiles",
      sourceId: id,
      ...(data !== undefined ? { czmlData: data, czml: data } : {}),
      ...(url ? { url } : {}),
      ...(sourcePath ? { sourcePath } : {}),
    },
    visible: true,
    opacity: 1,
    style: { ...DEFAULT_LAYER_STYLE },
    metadata: {
      sourceKind: CZML_SOURCE_KIND,
      externalNativeLayer: true,
      identifiable: false,
      sourceId: id,
      nativeLayerIds: [id],
      ...(url ? { czmlUrl: url } : {}),
    },
  };
}
