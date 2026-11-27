import { Action, ActionPanel, Detail, Icon, List, showToast, Toast } from "@raycast/api";
import { JSX, useCallback, useEffect, useRef, useState } from "react";
import {
  buildUpdateDps,
  getLightStatus,
  LightStatus,
  mapStatusFromDps,
  updateLightAndForget,
  LightUpdate,
} from "./communication";
import ColorPicker from "./colorPicker";
import {
  hsvHexToRgb,
  rgbToHsvHex,
  MIN_BRIGHTNESS_PERCENT,
  MAX_BRIGHTNESS_PERCENT,
  MIN_TEMPERATURE_KELVIN,
  MAX_TEMPERATURE_KELVIN,
} from "./utils";

const TEMPERATURE_PRESETS = [3000, 3500, 4500, 6500];
const BRIGHTNESS_PRESETS = [10, 25, 40, 60, 80, 100];
const BRIGHTNESS_STEP = 5;
const TEMPERATURE_STEP = 150;

// Raycast's Color.Raw is a plain CSS string
const tint = (red: number, green: number, blue: number): string => `rgb(${red}, ${green}, ${blue})`;

export default function Command(): JSX.Element {
  const [status, setStatus] = useState<LightStatus | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  /** The panel's DP 21 report is unreliable (it often claims 'white' while colour renders), so
   * the effective mode is tracked from our own writes within this view's lifetime. */
  const intendedModeRef = useRef<"white" | "colour" | undefined>(undefined);

  useEffect(() => {
    getLightStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(String(e)));
    // No shutdown()/process.exit() here (quirk #5 only applies to no-view commands): the device
    // connection is kept for further update actions while the view is open.
  }, []);

  const apply = useCallback(
    async (update: LightUpdate, feedback: string): Promise<void> => {
      if (!status) {
        return;
      }
      // Track the effective mode from our own writes: the panel's DP 21 report is unreliable.
      if (update.colorHsvHex !== undefined) {
        intendedModeRef.current = "colour";
      } else if (update.mode === "white") {
        intendedModeRef.current = "white";
      }
      // Optimistic local update: compute what the merged state will be, exactly like the write
      // will do, so the page reacts immediately (the panel does not ack, quirk #2).
      const knownForMerge = { ...status };
      const mergedDps = buildUpdateDps(knownForMerge, update);
      const optimistic: LightStatus = mapStatusFromDps({
        ...mergedDps,
        24: mergedDps[24] ?? status.colorHsvHex, // DP 24 is not written in white mode; keep known colour
      } as never) as LightStatus;
      setStatus(optimistic);
      try {
        // Full-state write: merge over the known state ("remember the state, send the new state").
        updateLightAndForget(status, update);
        await showToast(Toast.Style.Success, feedback);
        await showToast(Toast.Style.Success, feedback);
      } catch (e) {
        setStatus(status); // roll the optimistic update back on failure
        await showToast(Toast.Style.Failure, "Failed to update the light", String(e));
      }
    },
    [status],
  );

  if (error) {
    return (
      <Detail
        markdown={`**Loading light status failed.**\n\n\`${error}\`\n\nCheck the panel's power, the configured IP address, device ID and local key, then retry.`}
      />
    );
  }
  if (!status) {
    return <Detail isLoading markdown="Loading light status..." />;
  }

  const color = status.colorHsvHex ? hsvHexToRgb(status.colorHsvHex) : undefined;
  const brightness = status.brightnessPercent ?? 50;
  const kelvin = status.temperatureKelvin ?? 4000;

  // Remember the last value of the OTHER mode so switching between white and colour restores the
  // previous setting of the mode you switch to (like the app's White/Colour tabs).
  const lastColourHsvHex = status.colorHsvHex ?? rgbToHsvHex(255, 255, 255);
  const lastKelvin = kelvin;

  const actions = (
    <ActionPanel>
      <Action
        title={status.on ? "Turn Off" : "Turn On"}
        icon={Icon.Power}
        shortcut={{ modifiers: ["ctrl"], key: "space" }}
        onAction={() => apply({ on: !status.on }, status.on ? "Light turned off 💤" : "Light turned on 💡")}
      />
      {status.mode !== "colour" ? (
        <Action
          title={`Switch to Colour (${hsvHexToRgb(lastColourHsvHex) ? `rgb(${color?.red}, ${color?.green}, ${color?.blue})` : "colour"})`}
          icon={Icon.Brush}
          shortcut={{ modifiers: ["ctrl"], key: "c" }}
          onAction={() => apply({ colorHsvHex: lastColourHsvHex }, "Switched to colour mode")}
        />
      ) : (
        <Action
          title={`Switch to White (${lastKelvin} K)`}
          icon={Icon.Sun}
          shortcut={{ modifiers: ["ctrl"], key: "w" }}
          onAction={() =>
            apply({ mode: "white", temperatureKelvin: lastKelvin }, `Switched to white at ${lastKelvin} K`)
          }
        />
      )}
      <Action
        title={`Increase Brightness by ${BRIGHTNESS_STEP}%`}
        icon={Icon.ArrowUp}
        shortcut={{ modifiers: ["ctrl"], key: "+" }}
        onAction={() => {
          const next = Math.min(MAX_BRIGHTNESS_PERCENT, brightness + BRIGHTNESS_STEP);
          apply({ brightnessPercent: next }, `Brightness set to ${next} %`);
        }}
      />
      <Action
        title={`Decrease Brightness by ${BRIGHTNESS_STEP}%`}
        icon={Icon.ArrowDown}
        shortcut={{ modifiers: ["ctrl"], key: "-" }}
        onAction={() => {
          const next = Math.max(MIN_BRIGHTNESS_PERCENT, brightness - BRIGHTNESS_STEP);
          apply({ brightnessPercent: next }, `Brightness set to ${next} %`);
        }}
      />
      <Action
        title={`Increase Temperature by ${TEMPERATURE_STEP}K`}
        icon={Icon.ArrowUp}
        shortcut={{ modifiers: ["ctrl"], key: "l" }}
        onAction={() => {
          const next = Math.min(MAX_TEMPERATURE_KELVIN, kelvin + TEMPERATURE_STEP);
          apply({ temperatureKelvin: next }, `Color temperature set to ${next} K`);
        }}
      />
      <Action
        title={`Decrease Temperature by ${TEMPERATURE_STEP}K`}
        icon={Icon.ArrowDown}
        shortcut={{ modifiers: ["ctrl"], key: "h" }}
        onAction={() => {
          const next = Math.max(MIN_TEMPERATURE_KELVIN, kelvin - TEMPERATURE_STEP);
          apply({ temperatureKelvin: next }, `Color temperature set to ${next} K`);
        }}
      />
      <Action.Push
        title="Set Brightness preset"
        icon={Icon.Sun}
        shortcut={{ modifiers: ["opt"], key: "b" }}
        target={
          <NumericPresetList
            title="Set Brightness"
            presets={BRIGHTNESS_PRESETS}
            label={(v) => `${v} %`}
            onSet={(v) => apply({ brightnessPercent: v }, `Brightness set to ${v} %`)}
          />
        }
      />
      <Action.Push
        title="Set Color Temperature preset"
        icon={Icon.Temperature}
        shortcut={{ modifiers: ["opt"], key: "t" }}
        target={
          <NumericPresetList
            title="Set Color Temperature"
            presets={TEMPERATURE_PRESETS}
            label={(v) => `${v} K`}
            onSet={(v) => apply({ temperatureKelvin: v }, `Color temperature set to ${v} K`)}
          />
        }
      />
      <Action.Push
        title="Set Color"
        icon={Icon.Brush}
        shortcut={{ modifiers: ["opt"], key: "c" }}
        target={
          <ColorPicker
            initialHsvHex={status.colorHsvHex}
            onPick={(hsvHex, label) => apply({ colorHsvHex: hsvHex }, `Color set to ${label}`)}
          />
        }
      />
      <Action
        title="Refresh Status"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ["cmd"], key: "r" }}
        onAction={async () => {
          try {
            const fresh = await getLightStatus();
            setStatus(fresh);
            // Seed intent from hardware only until the first write; afterwards our own writes
            // define the mode because DP 21 reports are unreliable on this firmware.
            if (intendedModeRef.current === undefined) {
              intendedModeRef.current = fresh.mode === "colour" ? "colour" : "white";
            }
          } catch (e) {
            await showToast(Toast.Style.Failure, "Failed to load status", String(e));
          }
        }}
      />
    </ActionPanel>
  );

  return (
    <Detail
      navigationTitle={`Ledvance SMART+ WiFi ${status.on ? "💡" : "💤"}`}
      actions={actions}
      markdown={`
# Ledvance SMART+ WiFi

* **On/Off**:\t\t\t\t${status.on ? "💡 on" : "💤 off"}
* **Mode**:\t\t\t\t${status.mode}
* **Brightness**:\t\t\t${status.brightnessPercent !== undefined ? `${status.brightnessPercent} %` : "n/a"}\t\t\t\t*(${MIN_BRIGHTNESS_PERCENT}-${MAX_BRIGHTNESS_PERCENT} %)*
* **Temperature**:\t\t${status.temperatureKelvin !== undefined ? `${status.temperatureKelvin} K` : "n/a"}\t\t\t*(${MIN_TEMPERATURE_KELVIN}-${MAX_TEMPERATURE_KELVIN} K)*
* **Color**:\t\t\t\t${
        color
          ? `rgb(${color.red}, ${color.green}, ${color.blue})\n* **Color (DP 24)**:\t\`#${status.colorHsvHex?.toUpperCase()}\``
          : "n/a"
      }
  `.replace(/^[^\S\r\n]+/gm, "")}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="Power"
            text={status.on ? "On 💡" : "Off 💤"}
            icon={{ source: status.on ? Icon.LightBulb : Icon.CircleDisabled }}
          />
          <Detail.Metadata.Label title="Mode" text={status.mode} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Brightness"
            text={status.brightnessPercent !== undefined ? `${status.brightnessPercent} %` : "n/a"}
          />
          <Detail.Metadata.Label
            title="Color temperature"
            text={status.temperatureKelvin !== undefined ? `${status.temperatureKelvin} K` : "n/a"}
          />
          <Detail.Metadata.Label
            title="Color"
            text={color ? `rgb(${color.red}, ${color.green}, ${color.blue})` : "n/a"}
            icon={color ? { source: Icon.Circle, tintColor: tint(color.red, color.green, color.blue) } : undefined}
          />
        </Detail.Metadata>
      }
    />
  );
}

const NumericPresetList = ({
  title,
  presets,
  label,
  onSet,
}: {
  title: string;
  presets: number[];
  label: (value: number) => string;
  onSet: (value: number) => void;
}): JSX.Element => {
  return (
    <List navigationTitle={title}>
      {presets.map((preset) => (
        <List.Item
          key={preset}
          title={`Set ${label(preset)}`}
          actions={
            <ActionPanel>
              <Action title={`Set ${label(preset)}`} onAction={() => onSet(preset)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
};
