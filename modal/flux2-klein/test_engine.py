import io
import unittest

from PIL import Image, ImageChops

from engine import composite_watch_result, generation_size, validate_watch_inputs


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


class WatchCompositeTests(unittest.TestCase):
    def make_png(self, color: tuple[int, int, int], size: tuple[int, int] = (512, 512)) -> bytes:
        output = io.BytesIO()
        Image.new("RGB", size, color).save(output, "PNG")
        return output.getvalue()

    def make_mask(self) -> bytes:
        mask = Image.new("L", (512, 512), 0)
        for y in range(200, 312):
            for x in range(230, 282):
                mask.putpixel((x, y), 255)
        output = io.BytesIO()
        mask.save(output, "PNG")
        return output.getvalue()

    def test_validates_watch_inputs(self):
        source, mask = validate_watch_inputs(self.make_png((10, 20, 30)), self.make_mask())
        self.assertEqual(source.size, (512, 512))
        self.assertNotEqual(mask.getbbox(), None)

    def test_rejects_wrong_size_and_empty_mask(self):
        with self.assertRaisesRegex(ValueError, "512 x 512"):
            validate_watch_inputs(self.make_png((0, 0, 0), (256, 256)), self.make_mask())
        empty_mask = self.make_png((0, 0, 0))
        with self.assertRaisesRegex(ValueError, "empty"):
            validate_watch_inputs(self.make_png((0, 0, 0)), empty_mask)

    def test_composite_changes_only_masked_pixels(self):
        source = Image.new("RGB", (512, 512), (10, 20, 30))
        generated = Image.new("RGB", (512, 512), (220, 210, 200))
        mask = Image.open(io.BytesIO(self.make_mask())).convert("L")
        result = Image.open(io.BytesIO(composite_watch_result(source, generated, mask))).convert("RGB")

        outside = ImageChops.difference(source, result)
        outside.paste((0, 0, 0), mask=mask)
        self.assertIsNone(outside.getbbox())
        self.assertEqual(result.getpixel((256, 256)), (220, 210, 200))


if __name__ == "__main__":
    unittest.main()
