"""Standalone tests for antimeridian crossing handling in vector_ops."""

import unittest

from geolibre_server import vector_ops
from geolibre_server.vector_ops import run_vector_tool

ANTIMERIDIAN_LAYER = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "fiji_tonga"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [175.0, -18.0],
                        [-175.0, -18.0],
                        [-175.0, -16.0],
                        [175.0, -16.0],
                        [175.0, -18.0],
                    ]
                ],
            },
        }
    ],
}

SQUARE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "a"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [0.0, 0.0],
                        [0.0, 1.0],
                        [1.0, 1.0],
                        [1.0, 0.0],
                        [0.0, 0.0],
                    ]
                ],
            },
        }
    ],
}


class TestAntimeridianVectorOps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            vector_ops._import_geopandas()
            cls.has_geopandas = True
        except Exception:
            cls.has_geopandas = False

    def test_buffer_antimeridian_crossing_raises_value_error(self):
        if not self.has_geopandas:
            self.skipTest("GeoPandas not installed")
        with self.assertRaises(ValueError) as ctx:
            run_vector_tool("buffer", ANTIMERIDIAN_LAYER, parameters={"distance": 1})
        self.assertIn("crosses the antimeridian", str(ctx.exception))

    def test_centroids_antimeridian_crossing_raises_value_error(self):
        if not self.has_geopandas:
            self.skipTest("GeoPandas not installed")
        with self.assertRaises(ValueError) as ctx:
            run_vector_tool("centroids", ANTIMERIDIAN_LAYER)
        self.assertIn("crosses the antimeridian", str(ctx.exception))

    def test_normal_layer_buffer_succeeds(self):
        if not self.has_geopandas:
            self.skipTest("GeoPandas not installed")
        geojson, messages = run_vector_tool(
            "buffer", SQUARE, parameters={"distance": 1, "units": "kilometers"}
        )
        self.assertEqual(geojson["type"], "FeatureCollection")
        self.assertEqual(len(geojson["features"]), 1)
        self.assertTrue(messages and "Buffered" in messages[0])

    def test_normal_layer_centroids_succeeds(self):
        if not self.has_geopandas:
            self.skipTest("GeoPandas not installed")
        geojson, messages = run_vector_tool("centroids", SQUARE)
        self.assertEqual(geojson["type"], "FeatureCollection")
        self.assertEqual(geojson["features"][0]["geometry"]["type"], "Point")


if __name__ == "__main__":
    unittest.main()
