// Where to pick up a saved session: the saved question if it is still open,
// otherwise the next open question after it, otherwise the first open one, otherwise where it was.
export function resumeIndex({ items, responses = {}, current = 0 }) {
  const n = items.length;
  if (!n) return 0;
  const c = Math.min(Math.max(0, current | 0), n - 1);
  const open = (i) => !responses[items[i].id];
  if (open(c)) return c;
  for (let i = c + 1; i < n; i++) if (open(i)) return i;
  for (let i = 0; i < c; i++) if (open(i)) return i;
  return c;
}
