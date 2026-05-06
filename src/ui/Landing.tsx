import { useEffect, useState } from "react";

// Parent-facing landing page served at "/". The game itself lives at
// "/play" and stays a sealed box — no outbound links, no payment
// surfaces, no email mailto's reachable from inside it. Every adult
// affordance (support link, contact email, GitHub repo, install hint,
// privacy note) lives ONLY here.
//
// The design intent is "playful enough that a parent showing it to a kid
// doesn't break the vibe, but unambiguously a parent surface" — same
// palette + fonts as the menu, but a quieter information-dense layout
// instead of the chunky game cards. The Play button is the one piece
// styled to feel as tappable as anything in the game.

const KOFI_URL = "https://ko-fi.com/playletra";
const CONTACT_EMAIL = "hello@playletra.com";

export function Landing() {
  // Detect iOS so we can show the right "Add to Home Screen" copy. The
  // Android / desktop equivalent is the omnibox install icon, which is
  // less prescriptive — we only spell out the iOS path because that's
  // the platform with the back-swipe accident risk we're defending
  // against. Other platforms get a simpler "your browser will offer to
  // install this" line.
  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as Mac with touch points
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(iOSDevice);
  }, []);

  // The game canvas at /play wants the body locked at overflow:hidden +
  // touch-action:none (defined in index.html). The landing is a normal
  // scrollable page — relax those locks while we're mounted, restore on
  // unmount so the game gets its full-screen canvas back if the user
  // ever navigates back.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = {
      bodyOverflow: body.style.overflow,
      htmlOverflow: html.style.overflow,
      touchAction: body.style.touchAction,
      userSelect: body.style.userSelect,
      webkitUserSelect: body.style.webkitUserSelect,
    };
    body.style.overflow = "auto";
    html.style.overflow = "auto";
    body.style.touchAction = "auto";
    body.style.userSelect = "auto";
    body.style.webkitUserSelect = "auto";
    return () => {
      body.style.overflow = prev.bodyOverflow;
      html.style.overflow = prev.htmlOverflow;
      body.style.touchAction = prev.touchAction;
      body.style.userSelect = prev.userSelect;
      body.style.webkitUserSelect = prev.webkitUserSelect;
    };
  }, []);

  const handlePlay = () => {
    // Plain navigation rather than history.pushState — we want the game
    // bundle to mount fresh at /play, and Cloudflare Pages serves the
    // SPA fallback so this works as a top-level URL too (bookmarks,
    // shared links, the PWA start_url).
    window.location.assign("/play");
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "auto",
        background:
          "radial-gradient(circle at 50% 0%, #b6e2ff 0%, #7ec8ff 60%, #5fb1f0 100%)",
        fontFamily: "'Fredoka', system-ui, sans-serif",
        color: "#1c3550",
        WebkitTapHighlightColor: "transparent",
        // Allow scroll on this page even though the body is locked at
        // overflow:hidden for the game canvas — this nested scroll
        // container lets a parent reach the footer on a phone.
        touchAction: "auto",
        userSelect: "auto",
        WebkitUserSelect: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px 24px",
          gap: 32,
          maxWidth: 720,
          width: "100%",
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <img
          src="/letra-title.png"
          alt="Letra"
          draggable={false}
          style={{
            width: "min(86%, 480px)",
            height: "auto",
            filter: "drop-shadow(0 8px 0 rgba(0,0,0,0.12)) drop-shadow(0 16px 24px rgba(0,0,0,0.18))",
            userSelect: "none",
          }}
        />

        <p
          style={{
            fontSize: "clamp(18px, 2.4vw, 22px)",
            fontWeight: 600,
            lineHeight: 1.35,
            margin: 0,
            maxWidth: 480,
            color: "#16314c",
          }}
        >
          A free 3D letter-learning adventure for pre-K kids. Walk up to
          letters, hear them, earn trophies. No ads, no accounts, no
          tracking.
        </p>

        <PlayButton onClick={handlePlay} />

        <InstallHint isIOS={isIOS} />
      </main>

      <Footer />
    </div>
  );
}

function PlayButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const transform = pressed
    ? "translateY(6px)"
    : hover
      ? "translateY(-3px) scale(1.03)"
      : "translateY(0)";
  const shadow = pressed
    ? "0 4px 0 rgba(0,0,0,0.18), 0 6px 10px rgba(0,0,0,0.18)"
    : "0 12px 0 rgba(0,0,0,0.18), 0 18px 28px rgba(0,0,0,0.25)";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onTouchStart={() => setPressed(true)}
      onTouchEnd={() => setPressed(false)}
      aria-label="Play Letra"
      style={{
        appearance: "none",
        border: "8px solid white",
        background: "linear-gradient(180deg, #ffd95a 0%, #ffb01f 100%)",
        color: "#5a2a00",
        borderRadius: 36,
        padding: "22px 64px",
        fontFamily: "'Lilita One', 'Fredoka', system-ui, sans-serif",
        fontSize: "clamp(36px, 6vw, 56px)",
        fontWeight: 400,
        letterSpacing: 2,
        cursor: "pointer",
        boxShadow: shadow,
        transform,
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        textShadow: "0 3px 0 rgba(255,255,255,0.45)",
      }}
    >
      Play ▶
    </button>
  );
}

function InstallHint({ isIOS }: { isIOS: boolean }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.6)",
        border: "3px solid white",
        borderRadius: 22,
        padding: "16px 22px",
        maxWidth: 520,
        boxShadow: "0 6px 0 rgba(0,0,0,0.08)",
        fontSize: 16,
        fontWeight: 500,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ fontWeight: 700 }}>For the safest kid-mode:</strong>{" "}
      {isIOS ? (
        <>
          tap the <strong>Share</strong> button in Safari, then{" "}
          <strong>Add to Home Screen</strong>. Letra opens fullscreen with no
          back-swipe out, no other tabs to wander into.
        </>
      ) : (
        <>
          your browser can install Letra as an app — look for the install icon
          in the address bar, or use your browser's menu. Letra then opens in
          its own window with no other tabs to wander into.
        </>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer
      style={{
        background: "rgba(0, 30, 60, 0.08)",
        padding: "32px 24px 40px",
        marginTop: 24,
        fontSize: 15,
        lineHeight: 1.6,
        color: "#16314c",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>
          Letra runs entirely on your device. No accounts, no tracking, no
          data collected from your kid.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px 22px",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <FooterLink href={KOFI_URL} external icon="❤️">
            Support Letra
          </FooterLink>
          <FooterLink
            href={`mailto:${CONTACT_EMAIL}?subject=Letra%20feedback`}
            icon="✉️"
          >
            {CONTACT_EMAIL}
          </FooterLink>
        </div>

        <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
          Suggestions, bug reports, or just a hi — always welcome.
        </p>

        <p style={{ margin: 0, opacity: 0.65, fontSize: 14 }}>
          Built by a dad for his kids.
        </p>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  external,
  icon,
  children,
}: {
  href: string;
  external?: boolean;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      style={{
        color: "#16314c",
        background: "white",
        padding: "12px 22px",
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 16,
        textDecoration: "none",
        boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {icon && (
        <span
          aria-hidden
          style={{
            // Bigger emoji glyph than the surrounding text — gives the
            // chip a visible "icon" rather than a thin Unicode mark.
            // Variation selector U+FE0F on the emoji constants forces
            // the colored emoji rendering on macOS/iOS instead of the
            // monochrome text-style glyph.
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      )}
      <span>{children}</span>
    </a>
  );
}
