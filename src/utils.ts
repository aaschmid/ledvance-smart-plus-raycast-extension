import * as os from "os";
import * as path from "path";

export const MIN_BRIGHTNESS_PERCENT = 1;
export const MAX_BRIGHTNESS_PERCENT = 100;

/* Raw DP value ranges of the panel (see the brief):
 * - brightness DP 22: 10 (min) - 1000 (max)
 * - color temperature DP 23: 0 (warmest, 3000K) - 1000 (coldest, 6500K)
 */
const DP_BRIGHTNESS_MIN = 10;
const DP_BRIGHTNESS_MAX = 1000;
const DP_TEMPERATURE_MIN = 0;
const DP_TEMPERATURE_MAX = 1000;

export const MIN_TEMPERATURE_KELVIN = 3000;
export const MAX_TEMPERATURE_KELVIN = 6500;

export const percentToDpBrightness = (percent: number): number => {
  if (percent < MIN_BRIGHTNESS_PERCENT || percent > MAX_BRIGHTNESS_PERCENT) {
    throw new Error(`Invalid brightness ${percent}%, expected ${MIN_BRIGHTNESS_PERCENT}-${MAX_BRIGHTNESS_PERCENT}.`);
  }
  return DP_BRIGHTNESS_MIN + Math.round((percent / 100) * (DP_BRIGHTNESS_MAX - DP_BRIGHTNESS_MIN));
};

export const dpBrightnessToPercent = (dpBrightness: number): number => {
  const percent = Math.round(((dpBrightness - DP_BRIGHTNESS_MIN) / (DP_BRIGHTNESS_MAX - DP_BRIGHTNESS_MIN)) * 100);
  return Math.max(MIN_BRIGHTNESS_PERCENT, Math.min(MAX_BRIGHTNESS_PERCENT, percent));
};

export const kelvinToDpTemperature = (kelvin: number): number => {
  if (kelvin < MIN_TEMPERATURE_KELVIN || kelvin > MAX_TEMPERATURE_KELVIN) {
    throw new Error(
      `Invalid color temperature ${kelvin}K, expected ${MIN_TEMPERATURE_KELVIN}-${MAX_TEMPERATURE_KELVIN}.`,
    );
  }
  return DP_TEMPERATURE_MIN + Math.round(((kelvin - MIN_TEMPERATURE_KELVIN) / 3500) * DP_TEMPERATURE_MAX);
};

export const dpTemperatureToKelvin = (dpTemperature: number): number => {
  const kelvin = MIN_TEMPERATURE_KELVIN + (dpTemperature / DP_TEMPERATURE_MAX) * 3500;
  return Math.round(kelvin / 50) * 50;
};

/** HSV hue 0-360, saturation 0-1000, value 0-1000 as `HHHHSSSSVVVV` hex string, the format of DP 24. */
export const rgbToHsvHex = (red: number, green: number, blue: number): string => {
  if (isNaN(red) || isNaN(green) || isNaN(blue)) {
    throw new Error(`Invalid RGB values '${red},${green},${blue}', expected integers 0-255.`);
  }
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
    throw new Error(`Invalid RGB values '${red},${green},${blue}', expected integers 0-255.`);
  }
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round((h * 60 + 360) % 360);
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return (
    h.toString(16).padStart(4, "0") +
    Math.round(s * 1000)
      .toString(16)
      .padStart(4, "0") +
    Math.round(v * 1000)
      .toString(16)
      .padStart(4, "0")
  );
};

const hexDigitsToNumber = (hex: string, start: number, length: number): number => {
  return parseInt(hex.slice(start, start + length), 16);
};

/** Reverse of `rgbToHsvHex`: DP 24 `HHHHSSSSVVVV` hex string to RGB object with values 0-255. */
export const hsvHexToRgb = (hdpHex: string): { red: number; green: number; blue: number } => {
  if (hdpHex.length !== 12) {
    throw new Error(`Could not parse color '${hdpHex}', expected 12 hex digits like '012c03e803e8'.`);
  }
  const h = hexDigitsToNumber(hdpHex, 0, 4) / 360;
  const s = hexDigitsToNumber(hdpHex, 4, 4) / 1000;
  const v = hexDigitsToNumber(hdpHex, 8, 4) / 1000;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  return {
    red: Math.round(r * 255),
    green: Math.round(g * 255),
    blue: Math.round(b * 255),
  };
};

/** Sets the V (value/brightness) component of a DP 24 `HHHHSSSSVVVV` hex string: in colour mode the panel's brightness IS V. */
export const withBrightnessV = (hsvHex: string, percent: number): string => {
  if (percent < MIN_BRIGHTNESS_PERCENT || percent > MAX_BRIGHTNESS_PERCENT) {
    throw new Error(`Invalid brightness ${percent}%, expected ${MIN_BRIGHTNESS_PERCENT}-${MAX_BRIGHTNESS_PERCENT}.`);
  }
  const v = Math.round((percent / 100) * 1000)
    .toString(16)
    .padStart(4, "0");
  return hsvHex.slice(0, 8) + v;
};

const hexDigitPad = (value: number, digits = 4): string => {
  return Math.max(0, Math.round(value)).toString(16).padStart(digits, "0");
};

/** DP 24 `HHHHSSSSVVVV` from hue (0-360) and saturation/value (0-1000, the DP scale). */
export const hsvToHsvHex = (hue: number, saturation: number, value: number): string => {
  return hexDigitPad(hue % 360) + hexDigitPad(saturation) + hexDigitPad(value);
};

/** Path of the stop flag used by the Stop Scene command (cross-process via /tmp file). */
export const stopFlagPath = (): string => path.join(os.tmpdir(), "ledvance-smart-plus-scene-stop");

export const isNumeric = (value: string): boolean => /^(?:-?\d+(?:\.\d+)?|-)?$/.test(value);
