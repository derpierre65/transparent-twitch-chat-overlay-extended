export interface HostCallbacks {
  playSound(): unknown;
  logMessage(message: string): unknown;
}

export function getHost(): HostCallbacks | null {
  const hostObjects = (
    window as unknown as {
      chrome?: { webview?: { hostObjects?: Record<string, HostCallbacks | undefined> } };
    }
  ).chrome?.webview?.hostObjects;

  return hostObjects?.jsCallbackFunctions ?? null;
}

export function hostLog(message: string): void {
  console.warn(message);
  try {
    void Promise.resolve(getHost()?.logMessage(message)).catch(() => {});
  } catch {
    /* the host object may vanish in any app version */
  }
}
