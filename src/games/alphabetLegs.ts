// How the alphabet is split across the worlds.
//
// A leg is one world's share: land somewhere, find these letters, and the
// way onward opens. The sizes are small on purpose — six letters is about
// as long as a four-year-old will hunt before the next thing needs to
// happen, and the next thing is a ride into space.
//
// Five of them, so a full alphabet is four rides: sea, somewhere, sea,
// somewhere, sea — or, once the sea bed became a place of its own, any
// walk through the ocean's rooms and the worlds above it. The finale can
// therefore land anywhere, which is why the dance party is written
// against the letter's own frame rather than a ground plane: the ring
// bends around a star as readily as it lies flat on the sea.
export const LEG_SIZES = [6, 5, 5, 5, 5];

// The slice of the alphabet this leg gets, given how far the dealer has
// already got. Clamped so the last leg can never run past Z, however the
// sizes are re-tuned.
export function legSlice(
  leg: number,
  dealt: number,
  total: number,
): { from: number; to: number } {
  const size = LEG_SIZES[Math.min(Math.max(leg, 0), LEG_SIZES.length - 1)];
  const from = Math.min(dealt, total);
  return { from, to: Math.min(total, from + size) };
}
