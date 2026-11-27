import TuyaDevice from "tuyapi";
import { deviceId, deviceIp, deviceKey, deviceVersion } from "./preferences";
import { buildUpdateDps, LightDps, LightStatus, LightUpdate, mapStatusFromDps } from "./dpMapping";

export { mapStatusFromDps, buildUpdateDps };
export type { LightDps, LightStatus, LightUpdate };

const RESPONSE_TIMEOUT_MS = 5000;
const RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// tuyapi's type declarations do not export its option interfaces
interface MultipleSetOptions {
  multiple: true;
  data: Record<string, string | number | boolean>;
}

/**
 * Resolves with the next decrypted STATUS packet ('data' event), or `undefined` on timeout.
 * Per quirk #2 the panel only broadcasts on actual state change, so `undefined` usually means
 * "no change / no echo", not necessarily a failure.
 */
const waitForNextData = (dev: TuyaDevice, ms = RESPONSE_TIMEOUT_MS): Promise<{ dps: LightDps } | undefined> => {
  return new Promise((resolve) => {
    const onData = (data: { dps: LightDps }): void => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => {
      dev.removeListener("data", onData); // avoid dangling listeners leaking (MaxListenersExceededWarning)
      resolve(undefined);
    }, ms);
    dev.once("data", onData);
  });
};

/** Retries 3 times with ~2s pause: transient 'Err 914'-style failures right after panel power-on or reconnect (quirk #3). */
const withRetry = async <ResultT>(operation: () => Promise<ResultT>): Promise<ResultT> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
};

const createDevice = (): TuyaDevice => {
  const dev = new TuyaDevice({ id: deviceId, ip: deviceIp, key: deviceKey, version: deviceVersion });
  // quirk #4: stray/late packets emit 'error' events that would crash the process if unhandled
  dev.on("error", () => {});
  return dev;
};

let device: TuyaDevice | undefined;

/** Singleton per command invocation (each Raycast command run is a fresh process). */
const getDevice = (): TuyaDevice => {
  if (!device) {
    device = createDevice();
  }
  return device;
};

export const getLightStatus = async (): Promise<LightStatus> => {
  return withRetry(async () => {
    // Fresh connection per status query: after a set(), the panel stops answering on the old
    // socket (verified via debug dump - a refresh on a stale connection times out forever).
    if (device) {
      try {
        device.disconnect();
      } catch {
        // ignore stale socket state
      }
    }
    const dev = createDevice();
    device = dev;
    const answer = waitForNextData(dev);
    // quirk #1: panel does not echo sequenceN, so the refresh promise never resolves - fire and ignore
    // requestedDPS: this firmware answers a bare query with only DP 20 (power); explicitly
    // requesting DPs 20-24 yields the full map.
    dev.refresh({ requestedDPS: [20, 21, 22, 23, 24] }).catch(() => {});
    const data = await answer;
    if (!data) {
      throw new Error("No status response from the light (timeout).");
    }
    return mapStatusFromDps(data.dps);
  });
};

/**
 * Sends a state update: merges the user's change over the KNOWN state ("remember the state,
 * send the new state") into one full consistent DP write. The known state must be provided
 * (from a prior getLightStatus call or a cached estimate); a throw means all retries failed.
 */
export const updateLight = async (known: LightStatus, update: LightUpdate): Promise<LightStatus | undefined> => {
  return withRetry(async () => {
    const dev = getDevice();
    const dps = buildUpdateDps(known, update);
    const answer = waitForNextData(dev);
    // quirk #2: never await dev.set()'s promise, it may hang forever; capture rejections (Err 914) for retry
    let setError: unknown;
    dev.set({ multiple: true, data: dps } as unknown as MultipleSetOptions).catch((e: unknown) => {
      setError = e;
    });
    const data = await answer;
    if (!data) {
      if (setError !== undefined) {
        throw new Error(`Command not accepted by the light: ${String(setError)}`); // triggers quirk #3 retry
      }
      return undefined; // acceptable: panel does not ack, it only broadcasts on state change
    }
    return mapStatusFromDps(data.dps);
  });
};

/** Pure fire-and-forget variant: sends the command, does not wait for any echo (quirk #2). */
/** Fire-and-forget send of a pre-built raw DP payload (e.g. a static scene preset). */
export const updateLightDps = async (dps: Record<string, string | number | boolean>): Promise<void> => {
  return withRetry(async () => {
    const dev = getDevice();
    const answer = waitForNextData(dev);
    let setError: unknown;
    dev.set({ multiple: true, data: dps } as unknown as MultipleSetOptions).catch((e: unknown) => {
      setError = e;
    });
    const data = await answer;
    if (!data && setError !== undefined) {
      throw new Error(`Command not accepted by the light: ${String(setError)}`); // quirk #3 retry
    }
    // no-echo is fine: the payload is a complete state, no reconciliation needed
  });
};

/** Pure fire-and-forget variant of updateLight: merge over `known`, send, no echo awaited. */
export const updateLightAndForget = (known: LightStatus, update: LightUpdate): void => {
  const dev = getDevice();
  dev.set({ multiple: true, data: buildUpdateDps(known, update) } as unknown as MultipleSetOptions).catch(() => {});
};

export const shutdown = async (): Promise<void> => {
  try {
    // settle delay: fire-and-forget set() needs a moment to connect and flush before we disconnect
    await new Promise((resolve) => setTimeout(resolve, 500));
    device?.disconnect();
  } finally {
    // NOTE: no process.exit(0) here! The brief's quirk #5 applies to plain CLI processes; inside
    // Raycast, commands run in worker threads and process.exit kills the worker ("Worker exited"
    // error). Disconnecting is enough - Raycast reaps the command when its promise resolves.
  }
};
