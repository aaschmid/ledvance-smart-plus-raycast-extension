import { Action, ActionPanel, Grid, Icon, showToast, Toast } from "@raycast/api";
import { JSX, useState } from "react";
import { hsvHexToRgb } from "./utils";

/** Saturation levels (0-1000 DP scale) shown as grid columns next to the pure hue columns. */
const SATURATIONS = [1000, 750, 500, 250];

const VALUE_LEVELS = [100, 75, 50, 25];

/**
 * Hue × saturation color picker built on Raycast's Grid: each column is a hue (rows run through
 * saturation and value levels), rendered as solid color swatches.
 */
export default function ColorPicker({
  onPick,
  initialHsvHex,
}: {
  onPick: (hsvHex: string, label: string) => void;
  initialHsvHex?: string;
}): JSX.Element {
  const [picked, setPicked] = useState<string | undefined>(initialHsvHex);

  const swatches: { hsvHex: string; label: string }[] = [];
  for (let hue = 0; hue < 360; hue += 15) {
    for (const saturation of SATURATIONS) {
      for (const value of VALUE_LEVELS) {
        const h = hue.toString(16).padStart(4, "0");
        const s = saturation.toString(16).padStart(4, "0");
        const v = Math.round((value / 100) * 1000)
          .toString(16)
          .padStart(4, "0");
        swatches.push({ hsvHex: `${h}${s}${v}`, label: `H${hue} S${saturation} V${value}%` });
      }
    }
  }

  return (
    <Grid
      columns={8}
      aspectRatio={"1" as Grid.AspectRatio}
      inset={Grid.Inset.Small}
      navigationTitle="Pick a Color"
      searchBarAccessory={
        <Grid.Dropdown tooltip="Filter" storeValue>
          {["All", ...VALUE_LEVELS.map((v) => `V${v}%`)].map((v) => (
            <Grid.Dropdown.Item key={v} title={v} value={v} />
          ))}
        </Grid.Dropdown>
      }
    >
      {swatches
        .filter((swatch) => picked === undefined || swatch.hsvHex !== picked)
        .map((swatch) => {
          const { red, green, blue } = hsvHexToRgb(swatch.hsvHex);
          const cssColor = `rgb(${red}, ${green}, ${blue})`;
          return (
            <Grid.Item
              key={swatch.hsvHex}
              content={{ color: cssColor }}
              title={swatch.label}
              keywords={[swatch.hsvHex]}
              actions={
                <ActionPanel>
                  <Action
                    title={`Set Color ${swatch.label}`}
                    icon={{ source: Icon.Circle, tintColor: cssColor }}
                    onAction={() => {
                      setPicked(swatch.hsvHex);
                      showToast(Toast.Style.Success, `Picked ${swatch.label}`);
                      onPick(swatch.hsvHex, swatch.label);
                    }}
                  />
                </ActionPanel>
              }
            />
          );
        })}
    </Grid>
  );
}
