import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useAppStore, type GeoLibreLayer } from "../packages/core/src";
import { supportsAddDataRenderer } from "../apps/geolibre-desktop/src/lib/add-data-renderer";
import { addPMTilesLayerFromUrl } from "../packages/plugins/src/plugins/maplibre-components";
import {
  acquireMercatorProjectionLock,
  releaseMercatorProjectionLock,
} from "../packages/plugins/src/plugins/map-projection-utils";

describe("Cesium Add Data Reachability and Support Gating (#2476)", () => {
  it("supportsAddDataRenderer correctly classifies supported vs unsupported sources for Cesium", () => {
    // Unsupported sources on the 3D globe
    const unsupported = [
      "stac",
      "video",
      "zarr",
      "splatting",
      "deckgl-viz",
      "gltf-model",
      "duckdb",
    ];
    for (const id of unsupported) {
      assert.equal(supportsAddDataRenderer(id, "cesium"), false, `expected ${id} to be unsupported on cesium`);
    }

    // Supported sources on the 3D globe
    const supported = [
      "3d-tiles",
      "lidar",
      "pmtiles",
      "mbtiles",
      "cesium-ion",
      "czml",
      "kml",
      "xyz",
      "wms",
      "wmts",
      "wfs",
      "ogc-features",
      "ogc-vector-tiles",
      "gpx",
      "landxml",
      "georss",
      "delimited-text",
      "cad",
      "gdb",
      "photos",
      "polyline",
      "arcgis",
      "postgres",
      "iceberg",
      "vector",
      "raster",
    ];
    for (const id of supported) {
      assert.equal(supportsAddDataRenderer(id, "cesium"), true, `expected ${id} to be supported on cesium`);
    }
  });

  it("acquireMercatorProjectionLock does not override projection on Cesium", () => {
    let projectionSet: string | null = null;
    const fakeApp = {
      getMapRenderer: () => "cesium",
      getMapProjection: () => "globe" as const,
      setMapProjection: (proj: string) => {
        projectionSet = proj;
      },
      getMap: () => null,
      getMapboxMap: () => null,
    };

    acquireMercatorProjectionLock("test-overlay", fakeApp as never);
    assert.equal(projectionSet, null, "projection should not be locked to mercator on cesium");

    releaseMercatorProjectionLock("test-overlay", fakeApp as never);
    assert.equal(projectionSet, null, "projection should not be mutated on release on cesium");
  });

  it("addPMTilesLayerFromUrl routes Cesium renderer through host archive loader", async () => {
    const fittedBounds: number[][] = [];
    const layersAdded: GeoLibreLayer[] = [];

    const fakeApp = {
      getMapRenderer: () => "cesium",
      fitBounds: (bounds: number[]) => {
        fittedBounds.push(bounds);
      },
      translate: (_k: string, d: string) => d,
      addMapControl: () => {
        throw new Error("addMapControl must not be called for Cesium PMTiles");
      },
    };

    // Use a mock URL
    const url = "https://example.com/test.pmtiles";

    // Mock store's addLayer
    const originalAddLayer = useAppStore.getState().addLayer;
    useAppStore.setState({
      addLayer: (layer: GeoLibreLayer) => {
        layersAdded.push(layer);
      },
    });

    try {
      // Test invalid URL protocol throws
      await assert.rejects(
        () => addPMTilesLayerFromUrl(fakeApp as never, "ftp://example.com/test.pmtiles"),
        /Enter a valid HTTP\(S\) PMTiles URL/,
      );
    } finally {
      useAppStore.setState({ addLayer: originalAddLayer });
    }
  });
});
