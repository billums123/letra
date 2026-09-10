// How the alphabet is split across the worlds.
//
// A leg is one world's share: land somewhere, find these letters, and the
// way onward opens. The sizes are small on purpose — six letters is about
// as long as a four-year-old will hunt before the next thing needs to
// happen, and the next thing is a ride into space.
//
// The count is ODD, and that is load-bearing. The only way off a planet is
// the pool home, so legs strictly alternate sea, planet, sea, planet, sea:
// an odd number of them puts the last leg — and therefore the dance-party
// finale — back in the ocean every single time, where there is a whole sea
// to spread the ring across. Change this to an even number and the finale
// lands on a star, on a sphere the ring has to be bent around.
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
