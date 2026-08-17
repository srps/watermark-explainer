// Minimal query-param state: read once on mount, keep the URL current via
// replaceState (no history entries) so selections survive refresh and can be
// shared as links. Routes match on pathname; query strings are ours.

export function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export function writeParam(name: string, value: string | null) {
  writeParams({ [name]: value });
}

export function writeParams(values: Record<string, string | null>) {
  const url = new URL(window.location.href);
  Object.entries(values).forEach(([name, value]) => {
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  });
  window.history.replaceState(null, "", url);
}
