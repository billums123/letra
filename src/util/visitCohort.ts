// Which bucket this page load falls into: first time on this device,
// back within a week, or back after longer.
//
// Letra measures with Cloudflare Web Analytics and nothing else, and
// CF is deliberately cookieless — it cannot tell a returning visitor
// from a new one, which is exactly the number the launch plan turns on
// ("did a stranger's kid come back?"). The way to get it without
// adding any tracking is to let the answer decide the *path* the app
// pushes, so it lands as an ordinary pageview:
//
//   /play              a device that has never played
//   /play/again        back within 7 days
//   /play/again/later  back after longer
//
// Nothing about the device is sent anywhere. The bucket is derived on
// the device from one timestamp in localStorage, and CF only ever sees
// which of three paths was opened — it still cannot join two pageviews
// to the same person. public/privacy.html says exactly this.
//
// Computed once, at first import, and deliberately BEFORE the stamp is
// rewritten: every later read in the session sees the same answer.

const LAST_VISIT_KEY = "letra:lastVisit";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function computeCohort(): string {
  if (typeof window === "undefined") return "";
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_VISIT_KEY) ?? 0) || 0;
  } catch {
    // Private mode, or storage disabled. Treat as a first visit; the
    // count skews new, which is the honest direction to be wrong in.
  }
  const now = Date.now();
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(now));
  } catch {
    // Nothing to do — the bucket just stays "new" next time too.
  }
  if (!last) return "";
  // A clock that has gone backwards (timezone change, manual set)
  // would otherwise read as a negative gap and count as a return.
  const gap = now - last;
  if (gap < 0) return "/again";
  return gap <= WEEK_MS ? "/again" : "/again/later";
}

export const VISIT_COHORT = computeCohort();

// The menu's analytics path. App.tsx pushes this on the way in from the
// landing and Game.tsx uses it for the menu screen, so the two agree and
// entering the game costs one history entry rather than two.
export const MENU_PATH = `/play${VISIT_COHORT}`;
