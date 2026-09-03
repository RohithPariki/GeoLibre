import { resolveThreeDTilesRequestHeaders, type GeoLibreLayer } from "@geolibre/core";
import type { Cesium3DTileset, CesiumWidget, DataSource, ImageryLayer } from "@cesium/engine";

// Reconciles the store's `GeoLibreLayer[]` onto a Cesium globe, mirroring what
// MapController.syncLayers does for MapLibre. M3 covers the layer kinds where
// Cesium is the natural renderer: GeoJSON (as a draped GeoJsonDataSource), XYZ /
// WMS / WMTS / raster tiles (as ImageryLayers), and 3D Tiles (as a
// Cesium3DTileset). Other kinds are skipped on the globe (they still render in
// the 2D panes); the exported `isCesiumSupportedLayerType` lets the UI flag them.
//
// The engine is injected (the `Cesium` namespace + a `CesiumWidget`) so this module
// carries only type-only Cesium imports and never pulls the engine into the
// build graph itself.

type CesiumNs = typeof import("@cesium/engine");

/** Layer kinds this pass renders on the globe. */
const IMAGERY_TYPES = new Set(["raster", "xyz", "wms", "wmts", "image"]);

type EntryKind = "imagery" | "geojson" | "3dtiles";

interface LayerEntry {
  kind: EntryKind;
  /** The layer as last applied, for change detection. */
  layer: GeoLibreLayer;
  /** The Cesium object, or null while an async create is in flight. */
  handle: ImageryLayer | DataSource | Cesium3DTileset | null;
  /** Set when the entry is removed mid-load so the resolved handle is discarded. */
  cancelled: boolean;
  /** Last opacity key applied in place to a geojson entry (skips redundant restyles). */
  appliedAlpha?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function firstTile(layer: GeoLibreLayer): string | undefined {
  const tiles = layer.source.tiles;
  return Array.isArray(tiles) ? str(tiles[0]) : undefined;
}

function tilesetUrl(layer: GeoLibreLayer): string | undefined {
  return str(layer.source.url) ?? str(layer.sourcePath);
}

/**
 * Extracts the 2D bounding box [west, south, east, north] in degrees from
 * an image layer's source bounds or its four corner coordinates.
 */
function imageBounds(layer: GeoLibreLayer): [number, number, number, number] | undefined {
  const b = layer.metadata?.bounds;
  if (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    return [b[0], b[1], b[2], b[3]];
  }
  const c = layer.source.coordinates;
  if (
    Array.isArray(c) &&
    c.length === 4 &&
    c.every(
      (pt) =>
        Array.isArray(pt) &&
        pt.length >= 2 &&
        typeof pt[0] === "number" &&
        Number.isFinite(pt[0]) &&
        typeof pt[1] === "number" &&
        Number.isFinite(pt[1]),
    )
  ) {
    // Note: Reducing a georeferenced image's 4 corners to an axis-aligned min/max
    // bounding box will visibly distort rotated KML GroundOverlays since
    // SingleTileImageryProvider cannot render a skewed quad. This is an accepted
    // approximation for now.
    const lngs = c.map((pt) => pt[0]);
    const lats = c.map((pt) => pt[1]);
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  }
  return undefined;
}

/**
 * Whether the globe can render this layer *kind* at all (regardless of whether
 * its data has loaded yet). Exported so the UI can flag "2D only" layers on a
 * globe pane. See the module header for the supported kinds.
 */
export function isCesiumSupportedLayerType(layer: GeoLibreLayer): boolean {
  return layer.type === "geojson" || layer.type === "3d-tiles" || IMAGERY_TYPES.has(layer.type);
}

/** Whether this layer can render on the globe now (kind supported + data ready). */
function isSupported(layer: GeoLibreLayer): boolean {
  if (!isCesiumSupportedLayerType(layer)) return false;
  if (layer.type === "geojson") return Boolean(layer.geojson?.features?.length);
  if (layer.type === "3d-tiles") return Boolean(tilesetUrl(layer));
  if (layer.type === "raster") {
    if (
      layer.metadata?.sourceKind === "arcgis-map-service" ||
      layer.metadata?.sourceKind === "arcgis-image-service"
    ) {
      return Boolean(str(layer.sourcePath));
    }
  }
  if (layer.type === "image") {
    return Boolean(str(layer.source.url)) && Boolean(imageBounds(layer));
  }
  if (layer.type === "wms" || layer.type === "wmts") {
    return Boolean(str(layer.source.url)) || Boolean(firstTile(layer));
  }
  return Boolean(firstTile(layer));
}

function entryKind(layer: GeoLibreLayer): EntryKind {
  if (layer.type === "geojson") return "geojson";
  if (layer.type === "3d-tiles") return "3dtiles";
  return "imagery";
}

// Fill/stroke *colours*, stroke width, and marker colour bake into the GeoJSON
// entities at load, so a change to any of them forces a rebuild. Opacity
// (layer.opacity × fill opacity) is deliberately excluded: it is re-applied in
// place by applyGeoJsonStyle, so dragging the opacity slider restyles the fill
// alpha instead of reloading the whole GeoJsonDataSource on every tick.
function styleSignature(layer: GeoLibreLayer): string {
  const style = layer.style ?? {};
  return [style.fillColor, style.strokeColor, style.strokeWidth, style.markerColor].join("|");
}

/**
 * Whether the Cesium object must be rebuilt (vs. just re-styled) for the change
 * from `prev` to `next`. Live-settable appearance (visibility, imagery alpha) is
 * excluded; only source/data/geometry changes force a rebuild. The GeoJSON
 * FeatureCollection is compared by reference (the store swaps it on edit) and
 * its fill/stroke colours bake into the Cesium colours at load, so a colour
 * change rebuilds; opacity is restyled in place (see styleSignature).
 */
function needsRebuild(prev: GeoLibreLayer, next: GeoLibreLayer): boolean {
  if (prev.type !== next.type) return true;
  switch (entryKind(next)) {
    case "geojson":
      return prev.geojson !== next.geojson || styleSignature(prev) !== styleSignature(next);
    case "imagery":
      return (
        firstTile(prev) !== firstTile(next) ||
        // min/maxzoom bake into UrlTemplateImageryProvider's min/maximumLevel.
        prev.source.maxzoom !== next.source.maxzoom ||
        prev.source.minzoom !== next.source.minzoom ||
        str(prev.source.url) !== str(next.source.url) ||
        str(prev.sourcePath) !== str(next.sourcePath) ||
        str(prev.metadata?.arcgisSublayers) !== str(next.metadata?.arcgisSublayers) ||
        str(prev.source.token) !== str(next.source.token) ||
        str(prev.source.layers) !== str(next.source.layers) ||
        str(prev.source.layer) !== str(next.source.layer) ||
        str(prev.source.styles) !== str(next.source.styles) ||
        str(prev.source.style) !== str(next.source.style) ||
        str(prev.source.tileMatrixSetID) !== str(next.source.tileMatrixSetID) ||
        str(prev.source.tileMatrixSet) !== str(next.source.tileMatrixSet) ||
        // WMS/WMTS params baked into the provider at creation; a change must
        // rebuild it so the globe doesn't keep the stale provider.
        str(prev.source.format) !== str(next.source.format) ||
        str(prev.source.version) !== str(next.source.version) ||
        prev.source.transparent !== next.source.transparent ||
        JSON.stringify(imageBounds(prev)) !== JSON.stringify(imageBounds(next)) ||
        JSON.stringify(prev.source.requestHeaders ?? null) !==
          JSON.stringify(next.source.requestHeaders ?? null)
      );
    case "3dtiles":
      return (
        tilesetUrl(prev) !== tilesetUrl(next) ||
        JSON.stringify(prev.source.requestHeaders ?? null) !==
          JSON.stringify(next.source.requestHeaders ?? null) ||
        prev.source.altitudeOffset !== next.source.altitudeOffset
      );
  }
}

export class CesiumLayerSync {
  private readonly entries = new Map<string, LayerEntry>();
  /** Imagery id order last asserted on the globe, to skip redundant reorders. */
  private lastImageryOrder = "";
  /** Active layer list from the current/latest sync pass. */
  private currentLayers: GeoLibreLayer[] = [];

  constructor(
    private readonly Cesium: CesiumNs,
    private readonly viewer: CesiumWidget,
  ) {}

  /** Reconcile the globe to `layers` (order preserved for imagery stacking). */
  sync(layers: GeoLibreLayer[]): void {
    this.currentLayers = layers;
    const nextIds = new Set(layers.map((l) => l.id));
    for (const [id, entry] of this.entries) {
      if (!nextIds.has(id)) {
        this.destroyEntry(entry);
        this.entries.delete(id);
      }
    }

    // Tracks a create/rebuild of an imagery layer this pass (which re-appends it
    // to the top), so the reorder pass below runs even when the store id order
    // is unchanged.
    let imageryRebuilt = false;
    for (const layer of layers) {
      if (!isSupported(layer)) {
        // A previously-supported layer that became unrenderable (e.g. its data
        // was cleared) is torn down.
        const stale = this.entries.get(layer.id);
        if (stale) {
          this.destroyEntry(stale);
          this.entries.delete(layer.id);
        }
        continue;
      }

      const existing = this.entries.get(layer.id);
      if (!existing) {
        this.createEntry(layer);
        if (entryKind(layer) === "imagery") imageryRebuilt = true;
      } else if (needsRebuild(existing.layer, layer)) {
        this.destroyEntry(existing);
        this.entries.delete(layer.id);
        this.createEntry(layer);
        if (entryKind(layer) === "imagery") imageryRebuilt = true;
      } else {
        existing.layer = layer;
        this.applyAppearance(existing);
      }
    }

    // addImageryProvider always appends to the top, so a rebuild/create re-adds
    // imagery above its store neighbours, and a panel reorder (which doesn't
    // rebuild) changes the intended order without touching the globe. Re-assert
    // store order by raising each imagery layer to the top in turn (the base
    // imagery, never raised, stays at the bottom) — but only when the order
    // could actually have changed. sync() also runs on unrelated changes (e.g.
    // an opacity drag), and each raiseToTop is O(n), so reordering every time
    // would be a needless O(n²) on that hot path.
    const imageryOrder = layers
      .filter((l) => this.entries.get(l.id)?.kind === "imagery")
      .map((l) => l.id)
      .join("\n");
    if (imageryRebuilt || imageryOrder !== this.lastImageryOrder) {
      this.reorderImagery();
      this.lastImageryOrder = imageryOrder;
    }
  }

  destroy(): void {
    for (const entry of this.entries.values()) this.destroyEntry(entry);
    this.entries.clear();
  }

  private reorderImagery(): void {
    for (const layer of this.currentLayers) {
      const entry = this.entries.get(layer.id);
      if (entry?.kind === "imagery" && entry.handle) {
        this.viewer.imageryLayers.raiseToTop(entry.handle as ImageryLayer);
      }
    }
  }

  private createEntry(layer: GeoLibreLayer): void {
    const kind = entryKind(layer);
    const entry: LayerEntry = { kind, layer, handle: null, cancelled: false };
    this.entries.set(layer.id, entry);
    if (kind === "imagery") void this.createImagery(entry);
    else if (kind === "geojson") void this.createGeoJson(entry);
    else void this.createTileset(entry);
  }

  private async createImagery(entry: LayerEntry): Promise<void> {
    const { Cesium, viewer } = this;
    const layer = entry.layer;
    try {
      let provider: import("@cesium/engine").ImageryProvider | undefined;
      let isAsync = false;
      const headers = layer.source.requestHeaders as Record<string, string> | undefined;
      const makeResource = (url: string) =>
        headers && Object.keys(headers).length && url.startsWith("https://")
          ? new Cesium.Resource({ url, headers })
          : url;

      if (
        layer.type === "raster" &&
        (layer.metadata?.sourceKind === "arcgis-map-service" ||
          layer.metadata?.sourceKind === "arcgis-image-service") &&
        str(layer.sourcePath)
      ) {
        isAsync = true;
        const url = String(layer.sourcePath);
        const resource = makeResource(url);
        const sublayers = str(layer.metadata?.arcgisSublayers);
        const cleanLayers = sublayers?.replace(/^show:/i, "").trim() || undefined;
        const options: Record<string, unknown> = {};
        if (cleanLayers) options.layers = cleanLayers;
        const token = str(layer.source.token);
        if (token) {
          if (!url.startsWith("https://")) return;
          options.token = token;
        }

        if (typeof Cesium.ArcGisMapServerImageryProvider?.fromUrl === "function") {
          provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(resource, options);
        } else {
          provider = new (Cesium.ArcGisMapServerImageryProvider as unknown as new (
            opts: Record<string, unknown>,
          ) => import("@cesium/engine").ImageryProvider)({ url: resource, ...options });
        }
      } else if (layer.type === "image" && str(layer.source.url)) {
        isAsync = true;
        const url = String(layer.source.url);
        const bounds = imageBounds(layer);
        if (!bounds) return;
        const resource = makeResource(url);
        const rectangle = Cesium.Rectangle.fromDegrees(bounds[0], bounds[1], bounds[2], bounds[3]);
        const options = { rectangle };

        if (typeof Cesium.SingleTileImageryProvider?.fromUrl === "function") {
          provider = await Cesium.SingleTileImageryProvider.fromUrl(resource, options);
        } else {
          provider = new (Cesium.SingleTileImageryProvider as unknown as new (
            opts: Record<string, unknown>,
          ) => import("@cesium/engine").ImageryProvider)({ url: resource, ...options });
        }
      } else if (layer.type === "wms" && str(layer.source.url)) {
        const url = String(layer.source.url);
        const resource = makeResource(url);
        provider = new Cesium.WebMapServiceImageryProvider({
          url: resource as string,
          layers: String(layer.source.layers ?? ""),
          parameters: {
            transparent: layer.source.transparent !== false,
            format: str(layer.source.format) ?? "image/png",
            styles: str(layer.source.styles) ?? "",
            version: str(layer.source.version) ?? "1.1.1",
          },
        });
      } else if (
        layer.type === "wmts" &&
        str(layer.source.url) &&
        !firstTile(layer) &&
        (str(layer.source.layer) || str(layer.source.layers))
      ) {
        const url = String(layer.source.url);
        const resource = makeResource(url);
        const maxLevel = Number(layer.source.maxzoom);
        const minLevel = Number(layer.source.minzoom);
        provider = new Cesium.WebMapTileServiceImageryProvider({
          url: resource as string,
          layer: str(layer.source.layer) ?? str(layer.source.layers) ?? "",
          style: str(layer.source.style) ?? str(layer.source.styles) ?? "",
          format: str(layer.source.format) ?? "image/jpeg",
          tileMatrixSetID:
            str(layer.source.tileMatrixSetID) ?? str(layer.source.tileMatrixSet) ?? "default028mm",
          maximumLevel: Number.isFinite(maxLevel) ? maxLevel : undefined,
          minimumLevel: Number.isFinite(minLevel) ? minLevel : undefined,
        });
      } else {
        const url = firstTile(layer);
        if (!url) return;
        const resource = makeResource(url);
        const maxLevel = Number(layer.source.maxzoom);
        const minLevel = Number(layer.source.minzoom);
        provider = new Cesium.UrlTemplateImageryProvider({
          url: resource as string,
          maximumLevel: Number.isFinite(maxLevel) ? maxLevel : undefined,
          minimumLevel: Number.isFinite(minLevel) ? minLevel : undefined,
        });
      }

      if (!provider || entry.cancelled) return;
      // addImageryProvider appends above the base imagery (and earlier store
      // layers), so store order maps to Cesium's bottom-to-top stacking.
      const imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
      if (entry.cancelled) {
        viewer.imageryLayers.remove(imageryLayer, true);
        return;
      }
      entry.handle = imageryLayer;
      this.applyAppearance(entry);
      if (isAsync) {
        this.reorderImagery();
      }
    } catch {
      // A provider that throws synchronously (e.g. malformed params) or rejects
      // should not abort the sync pass; mirror createGeoJson/createTileset's best-effort.
    }
  }

  private async createGeoJson(entry: LayerEntry): Promise<void> {
    const { Cesium, viewer } = this;
    const layer = entry.layer;
    if (!layer.geojson) return;
    const style = layer.style ?? {};
    const fill = Cesium.Color.fromCssColorString(style.fillColor ?? "#3b82f6");
    const stroke = Cesium.Color.fromCssColorString(style.strokeColor ?? "#1e40af");
    // Fold the layer + fill opacity into the fill colour (a GeoJsonDataSource has
    // no global alpha). A later opacity change re-applies this alpha in place
    // (applyGeoJsonStyle) rather than reloading the whole data source.
    const fillAlpha = (style.fillOpacity ?? 0.6) * layer.opacity;
    try {
      const dataSource = await Cesium.GeoJsonDataSource.load(layer.geojson, {
        stroke,
        strokeWidth: style.strokeWidth ?? 2,
        fill: fill.withAlpha(fillAlpha),
        markerColor: Cesium.Color.fromCssColorString(style.markerColor ?? "#3b82f6"),
        clampToGround: true,
      });
      if (entry.cancelled) return;
      await viewer.dataSources.add(dataSource);
      if (entry.cancelled) {
        viewer.dataSources.remove(dataSource, true);
        return;
      }
      entry.handle = dataSource;
      // applyAppearance → applyGeoJsonStyle fades every entity kind (fill,
      // stroke, marker) by the layer opacity right after load, so points/lines
      // match the 2D map instead of rendering fully opaque.
      this.applyAppearance(entry);
    } catch {
      // A malformed FeatureCollection should not break the whole sync.
    }
  }

  private async createTileset(entry: LayerEntry): Promise<void> {
    const { Cesium, viewer } = this;
    const layer = entry.layer;
    const url = tilesetUrl(layer);
    if (!url) return;
    // Google Photorealistic tiles strip their X-GOOG-API-KEY from the store, so
    // resolve it back (from runtime env) exactly as the 2D render path does —
    // otherwise the tileset would silently 401/403 and never render on the globe.
    const headers = resolveThreeDTilesRequestHeaders(
      url,
      layer.source.requestHeaders as Record<string, string> | undefined,
    );
    const resource =
      headers && Object.keys(headers).length ? new Cesium.Resource({ url, headers }) : url;
    try {
      const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {});
      if (entry.cancelled) {
        tileset.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);
      this.applyTilesetAltitude(tileset, Number(layer.source.altitudeOffset));
      entry.handle = tileset;
      this.applyAppearance(entry);
    } catch {
      // A tileset that fails to load should not break the whole sync.
    }
  }

  /** Raise/lower a tileset by an altitude offset (metres) at its centre. */
  private applyTilesetAltitude(tileset: Cesium3DTileset, offset: number): void {
    if (!Number.isFinite(offset) || offset === 0) return;
    const { Cesium } = this;
    const carto = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center);
    const surface = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
    const target = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, offset);
    const translation = Cesium.Cartesian3.subtract(target, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
  }

  private applyAppearance(entry: LayerEntry): void {
    const { handle, layer } = entry;
    if (!handle) return;
    if (entry.kind === "imagery") {
      const imagery = handle as ImageryLayer;
      imagery.show = layer.visible;
      imagery.alpha = layer.opacity;
    } else if (entry.kind === "geojson") {
      (handle as DataSource).show = layer.visible;
      this.applyGeoJsonStyle(entry);
    } else {
      (handle as Cesium3DTileset).show = layer.visible;
    }
  }

  /**
   * Re-apply a GeoJSON layer's opacity in place, so dragging the opacity slider
   * restyles the entities instead of reloading the whole GeoJsonDataSource.
   * Polygon fill uses layer opacity × fill opacity; polyline stroke and point
   * markers use the layer opacity alone (matching the 2D map, where opacity
   * fades lines and points too). Colours themselves bake in at load, so a colour
   * change still rebuilds; the `appliedAlpha` guard makes a no-op call cheap on
   * unrelated syncs.
   */
  private applyGeoJsonStyle(entry: LayerEntry): void {
    const dataSource = entry.handle as DataSource | null;
    if (!dataSource) return;
    const style = entry.layer.style ?? {};
    const opacity = entry.layer.opacity;
    const fillAlpha = (style.fillOpacity ?? 0.6) * opacity;
    // Key on both alphas so any opacity change is picked up (e.g. a lines-only
    // layer whose fill alpha never varies).
    const key = `${fillAlpha}|${opacity}`;
    if (entry.appliedAlpha === key) return;
    entry.appliedAlpha = key;
    const { Cesium } = this;
    const fill = Cesium.Color.fromCssColorString(style.fillColor ?? "#3b82f6").withAlpha(fillAlpha);
    const stroke = Cesium.Color.fromCssColorString(style.strokeColor ?? "#1e40af").withAlpha(
      opacity,
    );
    // Point pins keep their baked-in colour; multiplying by white+alpha only
    // fades them.
    const marker = Cesium.Color.WHITE.withAlpha(opacity);
    for (const feature of dataSource.entities.values) {
      if (feature.polygon) {
        feature.polygon.material = new Cesium.ColorMaterialProperty(fill);
      }
      if (feature.polyline) {
        feature.polyline.material = new Cesium.ColorMaterialProperty(stroke);
      }
      if (feature.billboard) {
        feature.billboard.color = new Cesium.ConstantProperty(marker);
      }
    }
  }

  private destroyEntry(entry: LayerEntry): void {
    entry.cancelled = true;
    const { handle } = entry;
    if (!handle) return;
    if (entry.kind === "imagery") {
      this.viewer.imageryLayers.remove(handle as ImageryLayer, true);
    } else if (entry.kind === "geojson") {
      this.viewer.dataSources.remove(handle as DataSource, true);
    } else {
      this.viewer.scene.primitives.remove(handle as Cesium3DTileset);
    }
  }
}
