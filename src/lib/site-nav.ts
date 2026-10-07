// The site-wide hamburger menu: Rooms / Activity / auth / theme always, plus
// (when room-page.ts reveals it) the current room's three panel switches —
// one menu for the whole site, not a separate nav per page.
function elements() {
  return {
    toggle: document.getElementById("site-nav-toggle"),
    nav: document.getElementById("site-nav"),
    backdrop: document.getElementById("site-nav-backdrop"),
  };
}

export function closeSiteNav(): void {
  const { toggle, nav, backdrop } = elements();
  nav?.classList.remove("is-open");
  backdrop?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  nav?.setAttribute("aria-hidden", "true");
}

function openSiteNav(): void {
  const { toggle, nav, backdrop } = elements();
  nav?.classList.add("is-open");
  backdrop?.classList.add("is-open");
  toggle?.setAttribute("aria-expanded", "true");
  nav?.removeAttribute("aria-hidden");
}

export function initSiteNav(): void {
  const { toggle, nav, backdrop } = elements();
  const closeBtn = document.getElementById("site-nav-close");
  if (!(toggle instanceof HTMLButtonElement) || !nav || !backdrop) return;

  toggle.addEventListener("click", () => {
    if (nav.classList.contains("is-open")) closeSiteNav();
    else openSiteNav();
  });
  backdrop.addEventListener("click", closeSiteNav);
  closeBtn?.addEventListener("click", closeSiteNav);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSiteNav();
  });
  // A link (or a room panel switch) closes the panel before acting on it,
  // not leaving it open underneath whatever happens next.
  for (const item of nav.querySelectorAll("a, .room-nav-btn")) {
    item.addEventListener("click", closeSiteNav);
  }
}
