import { dpBrightnessToPercent, dpTemperatureToKelvin, kelvinToDpTemperature, percentToDpBrightness } from "./utils";

/** Live status of the panel, mapped from the raw DPs of the DP map of the brief. */
export interface LightStatus {
  on: boolean;
  mode: "white" | "colour" | "scene" | "music";
  /** 1-100 */
  brightnessPercent?: number;
  /** 3000-6500 */
  temperatureKelvin?: number;
  /** DP 24 `HHHHSSSSVVVV` (hue 0-360, sat 0-1000, val 0-1000, each as 4 hex digits) */
  colorHsvHex?: string;
}

/** A partial user-level change to merge over the known state. */
export interface LightUpdate {
  on?: boolean;
  mode?: "white" | "colour";
  /** 1-100 */
  brightnessPercent?: number;
  /** 3000-6500 (white mode attribute; stored while colour renders) */
  temperatureKelvin?: number;
  /** DP 24 `HHHHSSSSVVVV` hex string (colour mode attribute; stored while white renders) */
  colorHsvHex?: string;
}

/** Raw DPs of the panel (see brief: DP map of the Ledvance SMART+ WiFi Planon Plus). */
export interface LightDps {
  20?: boolean; // power
  21?: "white" | "colour" | "scene" | "music"; // mode
  22?: number; // brightness 10-1000 (white-mode carrier)
  23?: number; // color temperature 0-1000 (0 = warmest 3000K, 1000 = coldest 6500K)
  24?: string; // color as `HHHHSSSSVVVV` hex string; V is the brightness carrier in colour mode
}

const MODES = ["white", "colour", "scene", "music"] as const;

export const mapStatusFromDps = (dps: LightDps): LightStatus => {
  return {
    on: dps[20] === true,
    mode: MODES.includes(dps[21] as (typeof MODES)[number]) ? (dps[21] as LightStatus["mode"]) : "white",
    // The panel's own carriers, reported as-is (no interpretation, no guessing):
    ...(dps[22] !== undefined ? { whiteBrightnessPercent: undefined } : {}),
    ...(dps[23] !== undefined ? { temperatureKelvin: dpTemperatureToKelvin(dps[23]) } : {}),
    ...(dps[24] !== undefined ? { colorHsvHex: dps[24] } : {}),
    // Brightness: report DP 22 in white mode, V of DP 24 in colour mode (verified carriers).
    ...((dps[21] === "colour" && dps[24]?.length === 12
      ? { brightnessPercent: Math.round((parseInt(dps[24]!.slice(8, 12), 16) / 1000) * 100) }
      : dps[22] !== undefined
        ? { brightnessPercent: dpBrightnessToPercent(dps[22]) }
        : {}) as Partial<LightStatus>),
  } as LightStatus;
};

/**
 * Builds a FULL consistent DP write from the known state plus the user's changes
 * ("remember the state yourself, send the new state"). Every write carries all relevant DPs,
 * mutually consistent, so no carrier/mode inference is ever needed at write time:
 *
 * - DP 21: the effective mode = `update.mode` if switching, else the known mode
 * - DP 22: white-mode brightness, always kept consistent with the effective mode
 * - DP 23: stored CCT (colour mode) / active CCT (white mode)
 * - DP 24: stored colour (white mode) / active colour with V=brightness (colour mode)
 */
export const buildUpdateDps = (known: LightStatus, update: LightUpdate): LightDps => {
  const next: LightStatus = {
    on: update.on ?? known.on ?? true,
    // A colour update implies colour mode: setting a colour means you want to see it (the vendor
    // app behaves the same). This also makes callers correct even when known.mode comes from the
    // panel's unreliable DP 21 report (which claims 'white' while colour renders).
    mode: update.mode ?? (update.colorHsvHex !== undefined ? "colour" : known.mode === "colour" ? "colour" : "white"),
    brightnessPercent: update.brightnessPercent ?? known.brightnessPercent ?? 50,
    temperatureKelvin: update.temperatureKelvin ?? known.temperatureKelvin ?? 4000,
    colorHsvHex: update.colorHsvHex ?? known.colorHsvHex,
  };

  const dps: LightDps = {
    20: next.on,
    21: next.mode === "colour" ? "colour" : "white",
  };

  if (next.mode === "white") {
    // White role set: brightness + CCT. Colour stays stored in DP 24 untouched.
    dps[22] = percentToDpBrightness(next.brightnessPercent ?? 50);
    dps[23] = kelvinToDpTemperature(next.temperatureKelvin ?? 4000);
  } else {
    // Colour role set: colour with V = brightness. CCT stays stored in DP 23 untouched.
    const hsv = next.colorHsvHex ?? hsvHexFor(0, 1000, 1000);
    if (hsv.length === 12) {
      const v = Math.max(1, Math.round(((next.brightnessPercent ?? 50) / 100) * 1000));
      dps[24] = hsv.slice(0, 8) + v.toString(16).padStart(4, "0");
      // Verified: this firmware drops DP 22 on a colour switch; re-carry it in the same write so
      // the stored white brightness stays meaningful for later white-mode switches.
      dps[22] = percentToDpBrightness(next.brightnessPercent ?? 50);
      // Carry the stored CCT as well so a temperature change made in colour mode survives
      // and any later white-mode switch applies the exact CCT the user last chose.
      dps[23] = kelvinToDpTemperature(next.temperatureKelvin ?? 4000);
    }
  }

  return dps;
};

const hsvHexFor = (hue: number, saturation: number, value: number): string => {
  return (
    Math.round(hue).toString(16).padStart(4, "0") +
    Math.round(saturation).toString(16).padStart(4, "0") +
    Math.round(value).toString(16).padStart(4, "0")
  );
};
