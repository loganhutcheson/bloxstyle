import unittest

from engine import generation_size


class GenerationSizeTests(unittest.TestCase):
    def test_preserves_small_near_square_image(self):
        self.assertEqual(generation_size(512, 512), (512, 512))

    def test_rounds_to_model_friendly_dimensions(self):
        self.assertEqual(generation_size(585, 559), (592, 560))

    def test_caps_longest_side(self):
        self.assertEqual(generation_size(2048, 1024), (1024, 512))

    def test_rejects_invalid_dimensions(self):
        with self.assertRaises(ValueError):
            generation_size(0, 512)


if __name__ == "__main__":
    unittest.main()
