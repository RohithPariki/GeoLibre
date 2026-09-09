"""CZML dynamic 3D scene layers (issue #2290): builders, the Map API, and the MCP tool."""

from __future__ import annotations

import pytest

from geolibre import Map, project


def test_czml_layer_url_shape():
    layer = project.czml_layer("Satellites", url="https://example.com/sat.czml")
    assert layer["type"] == "3d-tiles"
    assert layer["source"] == {
        "type": "3d-tiles",
        "url": "https://example.com/sat.czml",
        "sourceId": layer["id"],
    }
    md = layer["metadata"]
    assert md["sourceKind"] == "czml"
    assert md["externalNativeLayer"] is True
    assert md["identifiable"] is False
    assert md["customLayerType"] == "3d-tiles"
    assert md["nativeLayerIds"] == [layer["id"]]
    assert "sourcePath" not in layer


def test_czml_layer_data_shape():
    packets = [
        {"id": "document", "name": "Dynamic", "version": "1.0"},
        {"id": "orbit", "point": {"pixelSize": 10}},
    ]
    layer = project.czml_layer("Inline Orbit", data=packets, source_path="/local/orbit.czml")
    assert layer["type"] == "3d-tiles"
    assert layer["source"]["czmlData"] == packets
    assert layer["source"]["sourcePath"] == "/local/orbit.czml"
    assert layer["sourcePath"] == "/local/orbit.czml"
    assert layer["metadata"]["sourceKind"] == "czml"


def test_czml_layer_requires_url_or_data():
    with pytest.raises(ValueError):
        project.czml_layer("Missing")


def test_map_add_czml():
    m = Map()
    layer_id = m.add_czml("https://example.com/orbit.czml", name="Globe Orbit")
    assert isinstance(layer_id, str)
    assert len(m.layers) == 1
    assert m.layers[0]["metadata"]["sourceKind"] == "czml"
