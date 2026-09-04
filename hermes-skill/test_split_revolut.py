import unittest

from split_revolut import boundaries, crop_regions


class SplitRevolutTest(unittest.TestCase):
    def test_regular_stitch_bands_drive_the_split(self):
        cuts = [11, 198, 359, 402, 2562, 4722, 6882, 9042]

        marks, target, strategy = boundaries(9339, 1440, cuts)

        self.assertEqual(strategy, "stitch-bands")
        self.assertEqual(target, 2160)
        self.assertEqual(marks[0], 0)
        self.assertEqual(marks[-1], 9339)
        self.assertNotIn(9042, marks)  # la coda corta viene unita, non eliminata

    def test_short_ui_rhythm_is_not_a_stitching_period(self):
        cuts = [11, 198, 359, 534, 2807]

        marks, target, strategy = boundaries(2935, 1440, cuts)

        self.assertEqual(strategy, "proportional")
        self.assertEqual(target, 1800)
        self.assertEqual(marks, [0, 1468, 2935])

    def test_fallback_scales_with_image_width(self):
        _, small_target, small_strategy = boundaries(5000, 720, [])
        marks, large_target, large_strategy = boundaries(5000, 1440, [])

        self.assertEqual(small_strategy, "proportional")
        self.assertEqual(large_strategy, "proportional")
        self.assertEqual(large_target, small_target * 2)
        self.assertEqual(marks[0], 0)
        self.assertEqual(marks[-1], 5000)

    def test_model_can_override_the_target_height(self):
        marks, target, strategy = boundaries(2935, 1440, [534], target_height=900)

        self.assertEqual(strategy, "proportional")
        self.assertEqual(target, 900)
        self.assertEqual(marks, [0, 734, 1468, 2201, 2935])

    def test_overlap_keeps_complete_coverage(self):
        regions = crop_regions(2000, [0, 1000, 2000], 120)

        self.assertEqual(regions, [(0, 1120), (880, 2000)])
        self.assertEqual(regions[0][0], 0)
        self.assertEqual(regions[-1][1], 2000)
        self.assertGreater(regions[0][1], regions[1][0])


if __name__ == "__main__":
    unittest.main()
