import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Feature, FeatureCollection } from "geojson";
import {
  DEFAULT_EDITOR_TRACKING_CONFIG,
  ensureEditorTrackingFields,
  isMaintainedEditorTrackingField,
  resolveEditorTrackingConfig,
  stampFeatureCollectionEditorTracking,
  stampFeatureEditorTracking,
  stampFeaturePropertiesEditorTracking,
} from "../packages/core/src/editor-tracking";

describe("editor-tracking", () => {
  it("resolveEditorTrackingConfig provides correct defaults when empty", () => {
    const resolved = resolveEditorTrackingConfig();
    assert.equal(resolved.enabled, false);
    assert.equal(resolved.createdByField, "created_by");
    assert.equal(resolved.createdAtField, "created_at");
    assert.equal(resolved.editedByField, "edited_by");
    assert.equal(resolved.editedAtField, "edited_at");
  });

  it("resolveEditorTrackingConfig throws on invalid configurations", () => {
    assert.throws(() => {
      resolveEditorTrackingConfig({ enabled: true, createdAtField: "same", editedAtField: "same" });
    }, /non-empty and unique/);

    assert.throws(() => {
      resolveEditorTrackingConfig({ enabled: true, createdByField: "   " });
    }, /non-empty and unique/);
  });

  it("isMaintainedEditorTrackingField correctly identifies tracking columns", () => {
    const config = { enabled: true };
    assert.equal(isMaintainedEditorTrackingField("created_by", config), true);
    assert.equal(isMaintainedEditorTrackingField("created_at", config), true);
    assert.equal(isMaintainedEditorTrackingField("edited_by", config), true);
    assert.equal(isMaintainedEditorTrackingField("edited_at", config), true);
    assert.equal(isMaintainedEditorTrackingField("name", config), false);
    assert.equal(isMaintainedEditorTrackingField("population", config), false);

    assert.equal(isMaintainedEditorTrackingField("created_by", { enabled: false }), false);

    const customConfig = {
      enabled: true,
      createdByField: "author",
      createdAtField: "created_time",
      editedByField: "modifier",
      editedAtField: "modified_time",
    };
    assert.equal(isMaintainedEditorTrackingField("author", customConfig), true);
    assert.equal(isMaintainedEditorTrackingField("created_by", customConfig), false);
  });

  it("ensureEditorTrackingFields adds fields when tracking is enabled", () => {
    const initialFields = ["id", "name"];
    const disabledResult = ensureEditorTrackingFields(initialFields, { enabled: false });
    assert.deepEqual(disabledResult, ["id", "name"]);

    const enabledResult = ensureEditorTrackingFields(initialFields, { enabled: true });
    assert.deepEqual(enabledResult, [
      "id",
      "name",
      "created_by",
      "created_at",
      "edited_by",
      "edited_at",
    ]);

    // Avoid duplicate field entries
    const existingResult = ensureEditorTrackingFields(["id", "created_by", "name"], {
      enabled: true,
    });
    assert.deepEqual(existingResult, [
      "id",
      "created_by",
      "name",
      "created_at",
      "edited_by",
      "edited_at",
    ]);
  });

  it("stampFeaturePropertiesEditorTracking creates timestamp and author on action='create'", () => {
    const props = { name: "Park", area: 50 };
    const stamped = stampFeaturePropertiesEditorTracking(props, "create", {
      config: { enabled: true },
      userIdentity: "alice",
      timestamp: "2026-08-14T12:00:00.000Z",
    });

    assert.equal(stamped.name, "Park");
    assert.equal(stamped.area, 50);
    assert.equal(stamped.created_by, "alice");
    assert.equal(stamped.created_at, "2026-08-14T12:00:00.000Z");
    assert.equal(stamped.edited_by, "alice");
    assert.equal(stamped.edited_at, "2026-08-14T12:00:00.000Z");
  });

  it("stampFeaturePropertiesEditorTracking updates edit info and preserves creation info on action='update'", () => {
    const props = {
      name: "Park",
      created_by: "alice",
      created_at: "2026-08-14T12:00:00.000Z",
      edited_by: "alice",
      edited_at: "2026-08-14T12:00:00.000Z",
    };

    const stamped = stampFeaturePropertiesEditorTracking(props, "update", {
      config: { enabled: true },
      userIdentity: "bob",
      timestamp: "2026-08-14T15:30:00.000Z",
    });

    assert.equal(stamped.created_by, "alice");
    assert.equal(stamped.created_at, "2026-08-14T12:00:00.000Z");
    assert.equal(stamped.edited_by, "bob");
    assert.equal(stamped.edited_at, "2026-08-14T15:30:00.000Z");
  });

  it("stampFeatureEditorTracking and stampFeatureCollectionEditorTracking work on GeoJSON features", () => {
    const feature: Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { label: "Tree" },
    };

    const stampedFeat = stampFeatureEditorTracking(feature, "create", {
      config: { enabled: true },
      userIdentity: "charlie",
      timestamp: "2026-08-14T10:00:00.000Z",
    });

    assert.equal(stampedFeat.properties?.created_by, "charlie");
    assert.equal(stampedFeat.properties?.edited_by, "charlie");

    const collection: FeatureCollection = {
      type: "FeatureCollection",
      features: [feature],
    };

    const stampedColl = stampFeatureCollectionEditorTracking(collection, "update", {
      config: { enabled: true },
      userIdentity: "dave",
      timestamp: "2026-08-14T18:00:00.000Z",
    });

    assert.equal(stampedColl.features[0].properties?.edited_by, "dave");
    assert.equal(stampedColl.features[0].properties?.edited_at, "2026-08-14T18:00:00.000Z");
  });

  it("does nothing when enabled is false", () => {
    const props = { name: "Lake" };
    const stamped = stampFeaturePropertiesEditorTracking(props, "create", {
      config: { enabled: false },
    });
    assert.deepEqual(stamped, { name: "Lake" });
  });
});
