import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { JSX } from "react";
import { STATIC_SCENES, ANIMATED_SCENES, AnimatedScene, StaticScene } from "./sceneData";
import { getLightStatus, updateLightAndForget, updateLightDps } from "./communication";
import { stopFlagPath } from "./utils";
import * as fs from "fs";

const STEP_MS = 150; // proven pacing: 120 steps x 150 ms ~ 18 s per revolution

/**
 * Scene picker: static presets are single full-state DP writes; animated scenes run as timed
 * DP-24 write loops inside this command's process (the panel renders colour; concurrency with
 * other commands is handled via the stop-token file). Stop restores neutral white.
 */
export default function ScenesView(): JSX.Element {
  const claimToken = (name: string): void => {
    try {
      fs.writeFileSync(stopFlagPath(), `${Date.now()}-${name}`);
    } catch {
      // ignore - best effort
    }
  };

  const applyStatic = async (scene: StaticScene): Promise<void> => {
    claimToken(scene.name);
    try {
      // A static preset IS a complete raw DP write, so it goes out as-is (no known-state merge).
      await updateLightDps(scene.dps);
      await showToast(Toast.Style.Success, `Scene "${scene.name}" applied`);
    } catch (e) {
      await showToast(Toast.Style.Failure, "Failed to apply scene", String(e));
    }
  };

  const runAnimated = async (scene: AnimatedScene): Promise<void> => {
    claimToken(scene.name);
    const token = fs.readFileSync(stopFlagPath(), "utf8");
    try {
      await showToast(Toast.Style.Success, `${scene.icon} ${scene.name} running until stopped`);
      let step = 0;
      let last = Date.now();
      for (;;) {
        if (fs.readFileSync(stopFlagPath(), "utf8") !== token) {
          return; // superseded by a newer scene claim
        }
        const hue = Math.round(((step % 120) / 120) * 360);
        const hex = hex4(hue) + hex4(1000) + hex4(scene.valueDp);
        updateLightAndForget(
          { on: true, mode: "colour", brightnessPercent: Math.round((scene.valueDp / 1000) * 100) },
          { colorHsvHex: hex },
        );
        await new Promise((r) => setTimeout(r, STEP_MS));
        step++;
        last = Date.now(); // keep the clock honest across timer jitter
        void last;
      }
    } catch (e) {
      await showToast(Toast.Style.Failure, "Scene animation failed", String(e));
    }
  };

  const stopScenes = async (): Promise<void> => {
    claimToken("stop");
    try {
      const known = await getLightStatus();
      updateLightAndForget(known, { on: true, mode: "white" });
      await showToast(Toast.Style.Success, "Scene stopped");
    } catch (e) {
      await showToast(Toast.Style.Failure, "Stopping failed", String(e));
    }
  };

  return (
    <List navigationTitle="Scenes">
      <List.Section title="Static scenes">
        {STATIC_SCENES.map((scene) => (
          <List.Item
            key={scene.name}
            title={`${scene.icon} ${scene.name}`}
            subtitle={scene.description}
            actions={
              <ActionPanel>
                <Action title="Apply" icon={Icon.Star} onAction={() => applyStatic(scene)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Animated scenes (run until stopped)">
        {ANIMATED_SCENES.map((scene) => (
          <List.Item
            key={scene.name}
            title={`${scene.icon} ${scene.name}`}
            subtitle={scene.description}
            actions={
              <ActionPanel>
                <Action title={`Run ${scene.name}`} icon={Icon.Play} onAction={() => runAnimated(scene)} />
                <Action
                  title="Stop Scene"
                  icon={Icon.Stop}
                  shortcut={{ modifiers: ["cmd"], key: "s" }}
                  onAction={() => stopScenes()}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
      <List.Section title="Stop">
        <List.Item
          title="Stop Scene"
          subtitle="Ends any running animation, back to neutral white"
          icon={Icon.Stop}
          actions={
            <ActionPanel>
              <Action title="Stop Scene" icon={Icon.Stop} onAction={() => stopScenes()} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

const hex4 = (v: number): string => Math.round(v).toString(16).padStart(4, "0");
