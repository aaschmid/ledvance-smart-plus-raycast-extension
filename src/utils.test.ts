import { describe, expect, test } from "vitest";
import {
  dpBrightnessToPercent,
  dpTemperatureToKelvin,
  hsvHexToRgb,
  kelvinToDpTemperature,
  percentToDpBrightness,
  rgbToHsvHex,
} from "./utils";

describe("percentToDpBrightness", () => {
  test("maps extremes per brief", () => {
    expect(percentToDpBrightness(1)).toBe(10 + Math.round((1 / 100) * 990)); // = 20
    expect(percentToDpBrightness(100)).toBe(1000);
  });

  test("rejects invalid input", () => {
    expect(() => percentToDpBrightness(0)).toThrow();
    expect(() => percentToDpBrightness(101)).toThrow();
  });
});

describe("dpBrightnessToPercent", () => {
  test("round trips the brief mapping", () => {
    for (const percent of [1, 40, 75, 100]) {
      expect(dpBrightnessToPercent(percentToDpBrightness(percent))).toBe(percent);
    }
  });
});

describe("kelvinToDpTemperature", () => {
  test("maps extremes per brief", () => {
    expect(kelvinToDpTemperature(3000)).toBe(0);
    expect(kelvinToDpTemperature(6500)).toBe(1000);
    expect(Math.round(kelvinToDpTemperature(4750))).toBe(500);
  });

  test("rejects out of range", () => {
    expect(() => kelvinToDpTemperature(2999)).toThrow();
    expect(() => kelvinToDpTemperature(6501)).toThrow();
  });
});

describe("dpTemperatureToKelvin", () => {
  test("round trips label range", () => {
    for (const kelvin of [3000, 3500, 4500, 6500]) {
      expect(dpTemperatureToKelvin(kelvinToDpTemperature(kelvin))).toBe(kelvin);
    }
  });
});

describe("rgbToHsvHex", () => {
  test("encodes verified examples from the brief", () => {
    // red verified against the panel's own report
    expect(rgbToHsvHex(255, 0, 0)).toBe("000003e803e8");
    // hue 300, sat 1000, val 1000 per the brief's DP 24 example '012c03e803e8'
    expect(rgbToHsvHex(255, 0, 255)).toBe("012c03e803e8");
  });

  test("produces 12 hex digits for arbitrary colors", () => {
    expect(rgbToHsvHex(0, 255, 0)).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("hsvHexToRgb", () => {
  test("round trips colors", () => {
    // allow rounding differences of +/- 1 per channel from the HSV round trip
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [170, 0, 255],
      [128, 64, 32],
      [255, 255, 255],
      [0, 0, 0],
    ] as const) {
      const { red, green, blue } = hsvHexToRgb(rgbToHsvHex(r, g, b));
      expect(Math.abs(red - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(green - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(blue - b)).toBeLessThanOrEqual(1);
    }
  });
});
