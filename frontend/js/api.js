// ==========================================================
// AI Report Analyst – Shared API helpers, loaded before every other script
// ==========================================================

const BACKEND_URL = window.location.origin;

function redirectToLogin() {
  window.location.replace("/login");
}

/** fetch() that sends the login cookie and goes to the sign-in page when the session has ended. */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  if (res.status === 401 && !url.includes("/api/auth/")) {
    redirectToLogin();
    // Never settles, so callers do not show an error while the page changes.
    return new Promise(() => {});
  }
  return res;
}
