// PWA install prompt capture (module-level so any view can trigger it).
let deferredEvent = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredEvent = event;
});

export function canInstall() { return Boolean(deferredEvent); }
export function promptInstall() {
  if (!deferredEvent) return false;
  deferredEvent.prompt();
  deferredEvent = null;
  return true;
}
