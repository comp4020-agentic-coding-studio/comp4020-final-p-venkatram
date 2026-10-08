// Why/How/What cycle through the same space with a wipe (src/styles/global.css's
// .hero-slide clip-path transition) — sequential, not simultaneous: the
// current slide wipes fully out before the next one starts wiping in, with
// a brief fully-hidden moment between them, rather than the two crossing
// over each other mid-transition. The headline and CTA buttons stay put —
// only this detail area cycles.
const VISIBLE_MS = 5000; // how long a slide stays fully shown before wiping out

export function initHeroCarousel(): void {
  const slides = Array.from(document.querySelectorAll<HTMLElement>(".hero-slide"));
  if (slides.length <= 1) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) return; // leave the first slide showing, no auto-cycling

  let index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active")),
  );

  // Waits for the slide's own clip-path transition to actually finish,
  // rather than guessing its duration in JS and risking the two drifting
  // out of sync if the CSS value ever changes.
  function onWipeComplete(slide: HTMLElement, run: () => void): void {
    const handle = (event: TransitionEvent) => {
      if (event.propertyName !== "clip-path") return;
      slide.removeEventListener("transitionend", handle);
      run();
    };
    slide.addEventListener("transitionend", handle);
  }

  function scheduleNext(): void {
    window.setTimeout(() => {
      const current = slides[index];
      if (!current) return;
      onWipeComplete(current, () => {
        index = (index + 1) % slides.length;
        slides[index]?.classList.add("is-active");
        scheduleNext();
      });
      current.classList.remove("is-active"); // wipe the current slide fully out first
    }, VISIBLE_MS);
  }

  scheduleNext();
}
