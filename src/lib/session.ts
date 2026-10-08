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

// Renders "Log in / Sign up" or "<name> · Log out" into the header's
// #auth-nav slot, present on every page via Layout.astro. Also the one place
// that decides whether the hamburger menu is even reachable — it starts
// `hidden` in Layout.astro's markup, and only this reveals it, for a
// signed-in visitor. /activity/ stays reachable by direct link either way;
// it just isn't offered in the menu to someone not signed in.
export async function renderAuthNav(): Promise<SessionUser | null> {
  const nav = document.getElementById("auth-nav");
  const navToggle = document.getElementById("site-nav-toggle");
  const user = await fetchSession();
  navToggle?.toggleAttribute("hidden", !user);
  if (!nav) return user;
  nav.textContent = "";
  if (user) {
    const name = document.createElement("span");
    name.className = "muted";
    name.textContent = user.displayName;
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn secondary";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async () => {
      await logout();
      window.location.href = "/";
    });
    nav.append(name, " ", logoutBtn);
  } else {
    const login = document.createElement("a");
    login.href = "/login/";
    login.textContent = "Log in";
    const signup = document.createElement("a");
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
