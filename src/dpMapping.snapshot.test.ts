import { describe, expect, test } from "vitest";
import { buildUpdateDps, LightStatus } from "./dpMapping";
import { percentToDpBrightness } from "./utils";

/**
 * Snapshot tests pinning the CURRENT, manually verified end-to-end change behaviour:
 * for every user action (given a realistic known state), the exact full DP write the extension
 * must produce. These are regression guards for the "remember the state, send the new state"
 * contract — if a future change alters any of these writes, a test fails and the change must be
 * checked against the panel again before shipping.
 *
 * Reference facts encoded here (from debug rounds against the real panel):
 * - white-mode brightness carrier: DP 22 = 10 + P/100 * 990
 * - CCT carrier: DP 23 = (K - 3000) / 3500 * 1000
 * - colour carrier: DP 24 = HHHH + SSSS + VVVV, V = P/100 * 1000
 * - colour updates imply colour mode; explicit white switch renders white immediately
 * - every write is full-state: power, mode, and the mode-relevant attributes always present
 */

const hex4 = (v: number): string => Math.round(v).toString(16).padStart(4, "0");
const br = (p: number): number => percentToDpBrightness(p);
const cct = (k: number): number => Math.round(((k - 3000) / 3500) * 1000);

/** Panel state after the user chose 60% white 4000K, with a stored green colour. */
const WHITE_60_4000: LightStatus = {
  on: true,
  mode: "white",
  brightnessPercent: 60,
  temperatureKelvin: 4000,
  colorHsvHex: "0140" + hex4(1000) + hex4(1000), // stored green, V=1000
};

/** Panel state while a green colour renders at 60% (after "Switch to Colour"). */
const COLOUR_GREEN_60: LightStatus = {
  on: true,
  mode: "colour",
  brightnessPercent: 60,
  temperatureKelvin: 4000,
  colorHsvHex: "0140" + hex4(1000) + hex4(600),
};

describe("snapshot: white-mode actions (working behaviour, do not change without hardware check)", () => {
  test("toggle power: white state fully re-carried, just power flipped", () => {
    expect(buildUpdateDps(WHITE_60_4000, { on: true })).toEqual({
      20: true,
      21: "white",
      22: br(60),
      23: cct(4000),
    });
  });

  test("brightness to 40: CCT kept, no DP 24 write", () => {
    expect(buildUpdateDps(WHITE_60_4000, { brightnessPercent: 40 })).toEqual({
      20: true,
      21: "white",
      22: br(40),
      23: cct(4000),
    });
  });

  test("temperature to 3500: brightness kept, no DP 24 write", () => {
    expect(buildUpdateDps(WHITE_60_4000, { temperatureKelvin: 3500 })).toEqual({
      20: true,
      21: "white",
      22: br(60),
      23: cct(3500),
    });
  });
});

describe("snapshot: colour-rendering actions (working behaviour, do not change without hardware check)", () => {
  test("brightness 40 while colour renders: colour + V re-carried, white carrier kept consistent", () => {
    const dps = buildUpdateDps(COLOUR_GREEN_60, { brightnessPercent: 40 });
    expect(dps[20]).toBe(true);
    expect(dps[21]).toBe("colour");
    expect(dps[24]).toBe("0140" + hex4(1000) + hex4(400)); // same colour, V=40%
    expect(dps[22]).toBe(br(40)); // white carrier kept consistent for later switches
    expect(dps[23]).toBe(cct(4000)); // stored CCT re-carried
  });

  test("temperature 5000 while colour renders: colour untouched, CCT stored only", () => {
    const dps = buildUpdateDps(COLOUR_GREEN_60, { temperatureKelvin: 5000 });
    expect(dps[21]).toBe("colour");
    expect(dps[24]).toBe("0140" + hex4(1000) + hex4(600)); // unchanged
    expect(dps[23]).toBe(cct(5000)); // stored
  });

  test("Switch to White: white role set with known brightness and CCT", () => {
    const dps = buildUpdateDps(COLOUR_GREEN_60, { mode: "white" });
    expect(dps[21]).toBe("white");
    expect(dps[22]).toBe(br(60));
    expect(dps[23]).toBe(cct(4000));
    expect(dps[24]).toBeUndefined(); // colour remains stored, not written
  });
});

describe("snapshot: cross-mode transitions (working behaviour, do not change without hardware check)", () => {
  test("pick a colour from white mode: implies colour write, white attributes re-carried", () => {
    const dps = buildUpdateDps(WHITE_60_4000, { colorHsvHex: "00f0" + hex4(1000) + hex4(0) });
    expect(dps[21]).toBe("colour"); // colour update implies colour mode
    expect(dps[24]).toBe("00f0" + hex4(1000) + hex4(600)); // V = known brightness 60%
    expect(dps[22]).toBe(br(60));
    expect(dps[23]).toBe(cct(4000));
  });

  test("root set color FF0000 while white renders (unreliable DP21 reporting white): still renders colour", () => {
    // The known mode here is what the panel's DP 21 report says - it LIES on this firmware.
    const lyingState: LightStatus = {
      on: true,
      mode: "white", // the lie: colour was actually rendering
      brightnessPercent: 55,
      temperatureKelvin: 3500,
      colorHsvHex: "0140" + hex4(1000) + hex4(550),
    };
    const dps = buildUpdateDps(lyingState, { colorHsvHex: "0000" + hex4(1000) + hex4(1000) });
    expect(dps[21]).toBe("colour"); // colour update implies colour mode, regardless of the lie
    expect(dps[24]).toBe("0000" + hex4(1000) + hex4(550));
  });

  test("round trip: colour -> Switch to White -> colour keeps attributes across modes", () => {
    // 1. pick blue at white state
    const first = buildUpdateDps(WHITE_60_4000, { colorHsvHex: "02bc" + hex4(1000) + hex4(0) });
    expect(first[21]).toBe("colour");
    // 2. switch back to white (state as the panel reports after the colour write)
    const afterColour: LightStatus = {
      on: true,
      mode: "colour",
      brightnessPercent: 60,
      temperatureKelvin: 4000,
      colorHsvHex: "02bc" + hex4(1000) + hex4(600),
    };
    const second = buildUpdateDps(afterColour, { mode: "white" });
    expect(second[21]).toBe("white");
    // 3. pick the same colour again from the white state: colour and brightness re-carried
    const third = buildUpdateDps(WHITE_60_4000, { colorHsvHex: "02bc" + hex4(1000) + hex4(0) });
    expect(third[24]).toBe("02bc" + hex4(1000) + hex4(600));
  });
});
