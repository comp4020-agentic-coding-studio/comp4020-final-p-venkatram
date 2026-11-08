// Shared client-side session check: every static page asks the server who
// (if anyone) the session cookie belongs to, since Astro's static output has
// no per-request server render to decide that at build time.
export interface SessionUser {
  id: string;
  displayName: string;
}

export async function fetchSession(): Promise<SessionUser | null> {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: SessionUser | null };
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
}

// Renders the identity ("<name>" or "Log in / Sign up") into the header's
// #auth-nav slot and the sign-out action into #auth-logout, present on every
// page via Layout.astro — split into two slots so Settings can sit between
// the username and the Log out button in the nav panel's markup.
// The hamburger menu itself only appears once a session is confirmed —
// logged-out visitors have no nav to open, just the brand link.
export async function renderAuthNav(): Promise<SessionUser | null> {
  const nav = document.getElementById("auth-nav");
  const logoutSlot = document.getElementById("auth-logout");
  const toggle = document.getElementById("site-nav-toggle");
  const siteNav = document.getElementById("site-nav");
  const user = await fetchSession();
  if (user) {
    toggle?.removeAttribute("hidden");
    siteNav?.removeAttribute("hidden");
  } else {
    toggle?.setAttribute("hidden", "");
    siteNav?.setAttribute("hidden", "");
  }
  if (nav) nav.textContent = "";
  if (logoutSlot) logoutSlot.textContent = "";
  if (user) {
    const name = document.createElement("p");
    name.className = "site-nav-heading";
    name.textContent = user.displayName;
    nav?.append(name);

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "site-nav-item";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async () => {
      await logout();
      window.location.href = "/";
    });
    logoutSlot?.append(logoutBtn);
  } else if (nav) {
    const login = document.createElement("a");
    login.className = "site-nav-item";
    login.href = "/login/";
    login.textContent = "Log in";
    const signup = document.createElement("a");
    signup.className = "site-nav-item";
    signup.href = "/signup/";
    signup.textContent = "Sign up";
    nav.append(login, signup);
  }
  return user;
}

// Pages whose content requires a session redirect here rather than rendering
// a half-built authenticated view.
export async function requireSession(): Promise<SessionUser> {
  const user = await fetchSession();
  if (!user) {
    window.location.href = "/login/";
    throw new Error("redirecting to login");
  }
  return user;
}
