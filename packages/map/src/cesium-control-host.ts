import * as maplibregl from "maplibre-gl";
import type { CesiumWidget } from "@cesium/engine";
import { useAppStore } from "@geolibre/core";

class CesiumMapFacade extends maplibregl.Evented {
  private sources = new Map<string, any>();
  private layers = new Map<string, any>();

  constructor(
    private host: CesiumControlHost,
    private viewer: any,
  ) {
    super();
  }

  getContainer() {
    return this.host.getContainer();
  }

  getCanvas() {
    return this.viewer.canvas;
  }

  isStyleLoaded() {
    return true;
  }

  setStyle(style: any, options?: any) {
    if (typeof style === "string") {
      useAppStore.getState().setBasemapStyleUrl(style);
      // Wait a tick for state propagation then emit style.load
      setTimeout(() => {
        this.fire(new maplibregl.Event("style.load"));
      }, 0);
    } else {
      throw new Error("CesiumControlHost: setStyle with an object is not supported.");
    }
    return this;
  }

  jumpTo(options: maplibregl.JumpToOptions) {
    if (options.center) {
      const center = maplibregl.LngLat.convert(options.center);
      useAppStore.getState().setMapView({
        center: [center.lng, center.lat],
        zoom: options.zoom ?? useAppStore.getState().mapView.zoom,
      });
    }
    return this;
  }

  flyTo(options: maplibregl.FlyToOptions) {
    return this.jumpTo(options as any);
  }

  easeTo(options: maplibregl.EaseToOptions) {
    return this.jumpTo(options as any);
  }

  addSource(id: string, source: any) {
    this.sources.set(id, source);
    return this;
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  removeSource(id: string) {
    this.sources.delete(id);
    return this;
  }

  addLayer(layer: any, beforeId?: string) {
    throw new Error("CesiumControlHost: addLayer is not supported on the globe.");
  }

  removeLayer(id: string) {
    this.layers.delete(id);
    useAppStore.getState().removeLayer(id);
    return this;
  }

  // Not implemented but required by IControl type definition/plugins in fallback
  project(lnglat: maplibregl.LngLatLike) {
    throw new Error("CesiumControlHost: project not implemented");
  }
  unproject(point: maplibregl.PointLike) {
    throw new Error("CesiumControlHost: unproject not implemented");
  }
  getCenter() {
    const view = useAppStore.getState().mapView;
    return new maplibregl.LngLat(view.center[0], view.center[1]);
  }
  getZoom() {
    return useAppStore.getState().mapView.zoom;
  }
  getBearing() {
    return 0; // Cesium camera mapping handles actual bearing, but keeping shim simple
  }
  getPitch() {
    return 0;
  }
  getBounds() {
    throw new Error("CesiumControlHost: getBounds not implemented");
  }

  // Throw explicitly for style-spec mutations
  setPaintProperty() {
    throw new Error("CesiumControlHost: setPaintProperty is not supported on the globe.");
  }
  setLayoutProperty() {
    throw new Error("CesiumControlHost: setLayoutProperty is not supported on the globe.");
  }
  getStyle() {
    throw new Error("CesiumControlHost: getStyle is not supported on the globe.");
  }
}

export class CesiumControlHost {
  private container: HTMLDivElement;
  private corners: Record<string, HTMLDivElement>;
  private controls = new Map<maplibregl.IControl, HTMLElement>();
  private facade: CesiumMapFacade;

  constructor(
    public viewer: CesiumWidget,
    containerParent: HTMLElement,
  ) {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-control-container";

    this.corners = {
      "top-left": document.createElement("div"),
      "top-right": document.createElement("div"),
      "bottom-left": document.createElement("div"),
      "bottom-right": document.createElement("div"),
    };

    for (const [pos, el] of Object.entries(this.corners)) {
      el.className = `maplibregl-ctrl-${pos}`;
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      el.style.zIndex = "2";
      this.container.appendChild(el);
    }

    containerParent.appendChild(this.container);
    this.facade = new CesiumMapFacade(this, viewer);
  }

  destroy() {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }

  getContainer() {
    return this.container;
  }

  addControl(control: maplibregl.IControl, position: maplibregl.ControlPosition = "top-right") {
    if (this.controls.has(control)) return false;

    const el = control.onAdd(this.facade as unknown as maplibregl.Map);
    el.style.pointerEvents = "auto";

    const corner = this.corners[position];
    if (corner) {
      corner.appendChild(el);
    }

    this.controls.set(control, el);
    return true;
  }

  removeControl(control: maplibregl.IControl) {
    if (!this.controls.has(control)) return;

    const el = this.controls.get(control)!;
    if (el.parentElement) {
      el.parentElement.removeChild(el);
    }

    control.onRemove(this.facade as unknown as maplibregl.Map);
    this.controls.delete(control);
  }
}

let primaryCesiumControlHost: CesiumControlHost | null = null;
export function getPrimaryCesiumControlHost() {
  return primaryCesiumControlHost;
}
export function setPrimaryCesiumControlHost(host: CesiumControlHost | null) {
  primaryCesiumControlHost = host;
}
