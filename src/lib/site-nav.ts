// The site-wide hamburger menu (Rooms / Activity / auth / theme) — separate
// from the room page's own sidebar (room-nav in room-page.ts), which is a
// different, always-visible nav for a different purpose.
export function initSiteNav(): void {
  const toggle = document.getElementById("site-nav-toggle");
  const nav = document.getElementById("site-nav");
  const backdrop = document.getElementById("site-nav-backdrop");
  const closeBtn = document.getElementById("site-nav-close");
  if (!(toggle instanceof HTMLButtonElement) || !nav || !backdrop) return;

  function open(): void {
    nav!.classList.add("is-open");
    backdrop!.classList.add("is-open");
    toggle!.setAttribute("aria-expanded", "true");
    nav!.removeAttribute("aria-hidden");
  }

  function close(): void {
    nav!.classList.remove("is-open");
    backdrop!.classList.remove("is-open");
    toggle!.setAttribute("aria-expanded", "false");
    nav!.setAttribute("aria-hidden", "true");
  }

  toggle.addEventListener("click", () => {
    if (nav!.classList.contains("is-open")) close();
    else open();
  });
  backdrop.addEventListener("click", close);
  closeBtn?.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
  // A link click should close the panel before the browser navigates, not
  // leave it open underneath the next page.
  for (const link of nav.querySelectorAll("a")) {
    link.addEventListener("click", close);
  }
}
