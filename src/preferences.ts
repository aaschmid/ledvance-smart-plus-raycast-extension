import { getPreferenceValues, PreferenceValues } from "@raycast/api";
import { isNumeric } from "./utils";

interface PreferenceValuesWithEnv extends PreferenceValues {
  TUYA_DEV_ID?: string;
  TUYA_IP?: string;
  TUYA_KEY?: string;
  TUYA_VER?: string;
}

const preferences: PreferenceValuesWithEnv = getPreferenceValues<PreferenceValuesWithEnv>();

export const deviceId = preferences.TUYA_DEV_ID ?? "";
export const deviceIp = preferences.TUYA_IP ?? "";
export const deviceKey = preferences.TUYA_KEY ?? "";
export const deviceVersion = preferences.TUYA_VER ?? "3.3";

// TUYA_DEV_ID / TUYA_IP / TUYA_KEY are enforced by Raycast itself ("required": true in the
// manifest): Raycast refuses to launch any command until they are set, showing its built-in
// configuration screen instead.

if (!isNumeric(deviceVersion.replace(".", ""))) {
  throw new Error(`Invalid Tuya protocol version '${deviceVersion}' set in TUYA_VER, expected e.g. '3.3'.`);
}
