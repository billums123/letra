// Eagerly warm the browser cache for every PNG the app shows. Creating an
// `Image` and assigning `.src` triggers a fetch the same way an `<img>` tag
// would; the result lands in the HTTP cache so subsequent renders paint
// from cache with no network round-trip. Call this once at boot.
//
// The list is hand-maintained because there are only ~16 assets and an
// import.meta.glob over /public would still need a manual sync.

import { TROPHIES } from "../state/trophies";

const STATIC_URLS: string[] = [
  "/letra-title.png",
  "/letra-icon.png",
  "/icons/spell-word.png",
  "/icons/find-alphabet.png",
  "/icons/match-sound.png",
  "/case-uppercase.png",
  "/case-lowercase.png",
  "/case-mixed.png",
];

export function preloadImages(): void {
  const trophyUrls = TROPHIES.map((t) => `/trophies/${t.id}.png`);
  for (const url of [...STATIC_URLS, ...trophyUrls]) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}
