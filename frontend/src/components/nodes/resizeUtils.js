// Given the box at resize-start and the box at resize-end, work out which
// edge moved on each axis and return it in the [x, y] direction form the
// snap logic expects: -1 = left/top edge moved, +1 = right/bottom edge
// moved, 0 = that axis didn't change.
//
// We compare geometry rather than trusting node-resizer's own `direction`,
// which is derived from the last mousemove delta and collapses to 0 on an
// axis whenever the final tick didn't move it — that's what made corner and
// edge snapping miss on release.
const EPS = 0.5; // px; resizer values can be fractional, so don't compare exactly

export function edgesMoved(start, end) {
  if (!start) return [0, 0];

  const leftMoved = Math.abs(end.x - start.x) > EPS;
  const rightMoved = Math.abs((end.x + end.width) - (start.x + start.width)) > EPS;
  const topMoved = Math.abs(end.y - start.y) > EPS;
  const bottomMoved = Math.abs((end.y + end.height) - (start.y + start.height)) > EPS;

  // A single handle moves at most one edge per axis (the opposite edge stays
  // pinned), so left/right and top/bottom are mutually exclusive here.
  const dx = leftMoved ? -1 : rightMoved ? 1 : 0;
  const dy = topMoved ? -1 : bottomMoved ? 1 : 0;
  return [dx, dy];
}
