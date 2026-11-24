type DomainChangeListener = () => void;

const listeners = new Set<DomainChangeListener>();

export function subscribeDomainChanges(listener: DomainChangeListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDomainChanged() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A stale screen must not break persistence for other subscribers.
    }
  }
}
