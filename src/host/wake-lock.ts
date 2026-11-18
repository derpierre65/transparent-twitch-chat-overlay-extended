/** Keeps the screen on while the page is visible. Silently does nothing where unsupported or denied. */
export function keepScreenAwake(doc: Document = document, nav: Navigator = navigator): void {
  if (!('wakeLock' in nav)) return;
  const request = (): void => {
    nav.wakeLock.request('screen').catch(() => {
      // Denied, e.g. in battery saver mode.
    });
  };
  request();
  // The browser drops the lock whenever the page is hidden.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') request();
  });
}
