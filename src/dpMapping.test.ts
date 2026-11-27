import { describe, expect, test } from "vitest";
import { buildUpdateDps, LightStatus, mapStatusFromDps } from "./dpMapping";

const hex4 = (n: number): string => Math.round(n).toString(16).padStart(4, "0");
const cctDp = (kelvin: number): number => Math.round(((kelvin - 3000) / 3500) * 1000);

const WHITE_STATE: LightStatus = {
  on: true,
  mode: "white",
  brightnessPercent: 60,
  temperatureKelvin: 4000,
  colorHsvHex: "012c03e803e8",
};

describe("buildUpdateDps: full-state merge writes", () => {
  test("power toggle keeps brightness, CCT and colour in the same write", () => {
    const dps = buildUpdateDps(WHITE_STATE, { on: false });
    expect(dps[20]).toBe(false);
    expect(dps[21]).toBe("white");
    expect(dps[22]).toBe(10 + Math.round(0.6 * 990)); // 604, from known state
    expect(dps[23]).toBe(cctDp(4000));
    // DP 24 is not written in white mode - the stored colour is untouched hardware-side.
    expect(dps[24]).toBeUndefined();
  });

  test("brightness change in white mode keeps CCT and does not touch DP 24", () => {
    const dps = buildUpdateDps(WHITE_STATE, { brightnessPercent: 40 });
    expect(dps[22]).toBe(10 + Math.round(0.4 * 990));
    expect(dps[23]).toBe(cctDp(4000));
    expect(dps[21]).toBe("white");
  });

  test("temperature change in white mode keeps brightness and does not touch DP 24", () => {
    const dps = buildUpdateDps(WHITE_STATE, { temperatureKelvin: 5000 });
    expect(dps[23]).toBe(cctDp(5000));
    expect(dps[22]).toBe(604);
    expect(dps[21]).toBe("white");
  });

  test("colour change carries the full consistent triple {21,22,24} with V=brightness", () => {
    const dps = buildUpdateDps(WHITE_STATE, { colorHsvHex: "012c03e8" + hex4(0), mode: "colour" });
    expect(dps[21]).toBe("colour");
    expect(dps[22]).toBe(604); // brightness re-carried
    expect(dps[24]).toBe("012c03e8" + hex4(600)); // V=60%
  });

  test("temperature change while colour renders keeps the colour and stores the CCT", () => {
    const COLOUR_STATE: LightStatus = { ...WHITE_STATE, mode: "colour", colorHsvHex: "012c03e8" + hex4(600) };
    const dps = buildUpdateDps(COLOUR_STATE, { temperatureKelvin: 3500 });
    expect(dps[21]).toBe("colour"); // no mode switch!
    expect(dps[24]).toBe("012c03e8" + hex4(600)); // colour untouched, V=brightness
    expect(dps[23]).toBe(cctDp(3500)); // new CCT stored
  });

  test("brightness change while colour renders re-carries the colour with the new V", () => {
    const COLOUR_STATE: LightStatus = { ...WHITE_STATE, mode: "colour", colorHsvHex: "012c03e8" + hex4(600) };
    const dps = buildUpdateDps(COLOUR_STATE, { brightnessPercent: 30 });
    expect(dps[21]).toBe("colour");
    expect(dps[24]).toBe("012c03e8" + hex4(300)); // new V=30%
    expect(dps[22]).toBe(10 + Math.round(0.3 * 990)); // kept consistent
  });

  test("explicit Switch to White renders white with the known brightness and CCT", () => {
    const COLOUR_STATE: LightStatus = { ...WHITE_STATE, mode: "colour", colorHsvHex: "012c03e8" + hex4(600) };
    const dps = buildUpdateDps(COLOUR_STATE, { mode: "white" });
    expect(dps[21]).toBe("white");
    expect(dps[22]).toBe(604);
    expect(dps[23]).toBe(cctDp(4000));
  });

  test("missing colour in known state falls back to a sane default colour", () => {
    const noColour = { ...WHITE_STATE };
    delete noColour.colorHsvHex;
    const dps = buildUpdateDps(noColour, { mode: "colour" });
    expect(dps[24]).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("mapStatusFromDps", () => {
  test("white mode: brightness from DP 22", () => {
    const s = mapStatusFromDps({ 20: true, 21: "white", 22: 604, 23: 143 });
    expect(s.brightnessPercent).toBe(60);
    expect(s.temperatureKelvin).toBe(3500);
  });

  test("colour mode: brightness from the V component of DP 24", () => {
    const s = mapStatusFromDps({ 20: true, 21: "colour", 22: 1000, 24: "012c03e80258" });
    expect(s.brightnessPercent).toBe(60); // V=0x0258=600
    expect(s.colorHsvHex).toBe("012c03e80258");
  });

  test("power-only report yields on/off without invented values", () => {
    const s = mapStatusFromDps({ 20: false });
    expect(s.on).toBe(false);
    expect(s.brightnessPercent).toBeUndefined();
  });
});
