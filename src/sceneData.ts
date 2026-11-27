import { hsvToHsvHex } from "./utils";

/** A static scene: a single DP write through the normal retry wrapper (rule 4). */
export interface StaticScene {
  name: string;
  icon: string;
  description: string;
  dps: Record<string, string | number | boolean>;
}

/** An animated scene: a hue-cycling DP-24 write loop, fixed duration, then the process exits. */
export interface AnimatedScene {
  name: string;
  icon: string;
  description: string;
  /** Constant V component on the DP scale (1000 = '03e8' full brightness, 330 = '014a' ~33 %). */
  valueDp: number;
}

/* Static presets — exact DP payloads from the scenes spec (raw DP values). */
export const STATIC_SCENES: StaticScene[] = [
  {
    name: "Night",
    icon: "🌙",
    description: "Very dim, warmest (DP 22=100, 23=0)",
    dps: { 21: "white", 22: 100, 23: 0 },
  },
  {
    name: "Read",
    icon: "📖",
    description: "Bright, coldest (DP 22=1000, 23=1000)",
    dps: { 21: "white", 22: 1000, 23: 1000 },
  },
  {
    name: "Meeting/Work",
    icon: "🎯",
    description: "Bright-cool working light (DP 22=800, 23=800)",
    dps: { 21: "white", 22: 800, 23: 800 },
  },
];

/* Animated scenes — hue cycles over DP 21/24, full saturation, fixed V per scene (spec). */
export const ANIMATED_SCENES: AnimatedScene[] = [
  {
    name: "Rainbow",
    icon: "🌈",
    description: "Full-saturation hue revolution, runs until stopped",
    valueDp: 1000, // '03e8'
  },
  {
    name: "Leisure",
    icon: "🎨",
    description: "Dim (~33 %) hue revolution, runs until stopped",
    valueDp: 330, // '014a'
  },
];

export const HUE_STEPS = 120; // 3° per step, proven pacing from the spec

/**
 * One animation step: DP 21/24 write with hue at `stepIndex`, fire-and-forget (rule 1 — never
 * await echoes between steps, consecutive changes are too fast/noisy for the panel to ack).
 */
export const hueStepDps = (stepIndex: number, valueDp: number): Record<string, string | number | boolean> => {
  const hue = Math.round(((stepIndex % HUE_STEPS) / HUE_STEPS) * 360);
  return { 21: "colour", 24: hsvToHsvHex(hue, 1000, valueDp) };
};
