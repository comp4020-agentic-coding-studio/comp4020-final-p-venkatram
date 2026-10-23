// Signs a session out after a stretch of no user activity — armed only once
// a session actually exists (a logged-out visitor has nothing to expire).
// "Activity" is any of the input events a real person generates; scroll and
// touch are included alongside mouse/keyboard so this doesn't fire under
// someone who's just reading a long lyrics sheet or activity feed.
import { logout } from "./session";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;

export function initIdleLogout(): void {
  let timer: number | undefined;

  function onTimeout(): void {
    for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, resetTimer);
    void logout().then(() => {
      window.location.href = "/login/";
    });
  }

  function resetTimer(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(onTimeout, IDLE_TIMEOUT_MS);
  }

  for (const event of ACTIVITY_EVENTS) window.addEventListener(event, resetTimer, { passive: true });
  resetTimer();
}
