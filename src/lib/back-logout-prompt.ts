// Landing-page-only: if pressing the browser's back button is what brought
// a logged-in user back to "/", ask whether they meant to log out too. This
// is an MPA with no pushState anywhere, so "back to here" is detected via
// the Navigation Timing API (fresh back/forward load) and the pageshow
// event's `persisted` flag (bfcache restore) rather than popstate, which
// never fires for plain full-page navigations.
import { fetchSession, logout } from "./session";

export function initBackLogoutPrompt(): void {
  function arrivedViaBackForward(): boolean {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entry?.type === "back_forward";
  }

  async function maybePromptLogout(): Promise<void> {
    const user = await fetchSession();
    if (!user) return;
    const shouldLogout = window.confirm(`You're still signed in as ${user.displayName}. Log out?`);
    if (!shouldLogout) return;
    await logout();
    window.location.href = "/login/";
  }

  if (arrivedViaBackForward()) void maybePromptLogout();
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void maybePromptLogout();
  });
}
