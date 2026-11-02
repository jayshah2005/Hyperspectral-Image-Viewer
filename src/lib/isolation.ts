/** How long to wait for the service worker on a first visit before carrying on without it. */
const WAIT_MS = 1500;

/** True once the service worker has taken over a page that didn't have it. */
async function install(): Promise<boolean> {
  const sw = navigator.serviceWorker;
  // Controlled yet not isolated, or installed yet not in control (a hard reload): another reload wouldn't help.
  if (sw.controller || (await sw.getRegistration())?.active) return false;
  const changed = new Promise<boolean>((resolve) => {
    sw.addEventListener('controllerchange', () => resolve(true), { once: true });
  });
  await sw.register(new URL('coi-sw.js', document.baseURI).href);
  return changed;
}

/**
 * Multi-threading makes SAM several times faster on the processor, and needs cross-origin isolation. On a first
 * visit this installs the service worker that provides it and reloads once, before anything is on screen.
 * The app starts straight after this, so nothing here may fail or wait for long: if any of it isn't possible, the
 * app simply runs single-threaded.
 */
export async function ensureIsolation(): Promise<void> {
  if (!import.meta.env.PROD || self.crossOriginIsolated || !('serviceWorker' in navigator)) return;
  try {
    const giveUp = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WAIT_MS));
    if (await Promise.race([install(), giveUp])) {
      location.reload();
      await new Promise(() => undefined); // nothing more should run on the page being replaced
    }
  } catch {
    /* Private browsing and some settings block service workers. */
  }
}
