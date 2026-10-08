// Why/How/What cycle through the same space, fading one out as the next
// fades in, rather than stacking all three (which either overflows the
// hero's own height or forces it much taller than the photo). The headline
// and CTA buttons stay put — only this detail area cycles.
const INTERVAL_MS = 5000;

export function initHeroCarousel(): void {
  const slides = Array.from(document.querySelectorAll<HTMLElement>(".hero-slide"));
  if (slides.length <= 1) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) return; // leave the first slide showing, no auto-cycling

  let index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active")),
  );

  setInterval(() => {
    slides[index]?.classList.remove("is-active");
    index = (index + 1) % slides.length;
    slides[index]?.classList.add("is-active");
  }, INTERVAL_MS);
}
