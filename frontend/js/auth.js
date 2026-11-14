// ==========================================================
// AI Report Analyst – Auth: sign-in page, sign-up page, and the account menu
// Each part runs only on the page that has its elements.
// ==========================================================

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// ==========================================================
// Helpers
// ==========================================================

function digitsOf(text) {
  return text.replace(/\D/g, "");
}

function isEmailOrPhone(value) {
  return value.includes("@") ? EMAIL_PATTERN.test(value) : digitsOf(value).length >= 8;
}

function initialsOf(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";
}

/** Shows a message under one field, or clears it when message is empty. Accepts trusted HTML. */
function setFieldError(name, message = "", html = false) {
  const field = document.querySelector(`[data-field="${name}"]`);
  const error = document.getElementById(`${name}Error`);
  if (!field || !error) return;
  field.classList.toggle("invalid", Boolean(message));
  if (html) error.innerHTML = message;
  else error.textContent = message;
  field.querySelector("input")?.setAttribute("aria-invalid", message ? "true" : "false");
}

function clearFieldErrors(form) {
  form.querySelectorAll("[data-field]").forEach((field) => setFieldError(field.dataset.field));
}

function focusFirstError(form) {
  form.querySelector(".field.invalid input, .field.invalid select")?.focus();
}

function showBanner(id, message) {
  const banner = document.getElementById(id);
  if (!banner) return;
  document.getElementById(`${id}Text`).textContent = message || "";
  banner.classList.toggle("hidden", !message);
}

/** Puts a button into its loading state, and disables the form's inputs while it lasts. */
function setLoading(button, loading, text) {
  if (loading) {
    button.dataset.label = button.innerHTML;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${text}`;
  } else if (button.dataset.label) {
    button.innerHTML = button.dataset.label;
  }
  button.disabled = loading;
  button.form?.querySelectorAll("input, select, button").forEach((control) => {
    if (control !== button) control.disabled = loading;
  });
}

async function postJSON(path, body) {
  const res = await apiFetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// -- Show/hide password buttons --
document.querySelectorAll(".toggle-visibility").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.getAttribute("aria-controls"));
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
});

// ==========================================================
// Sign-in page
// ==========================================================

const $loginForm = document.getElementById("loginForm");

if ($loginForm) {
  const $identifier = document.getElementById("identifier");
  const $password = document.getElementById("password");
  const $remember = document.getElementById("remember");
  const $submit = document.getElementById("loginSubmit");

  document.getElementById("loginBannerClose").addEventListener("click", () => showBanner("loginBanner", ""));
  document.getElementById("forgotLink").addEventListener("click", (e) => {
    e.preventDefault();
    showBanner("loginBanner", "Password reset is not available yet. Please contact your admin.");
  });

  // Errors go away as soon as the user starts fixing them.
  [$identifier, $password].forEach((input) => {
    input.addEventListener("input", () => setFieldError(input.id));
  });

  $loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors($loginForm);
    showBanner("loginBanner", "");

    const identifier = $identifier.value.trim();
    if (!identifier) setFieldError("identifier", "Enter your email or phone number.");
    else if (!isEmailOrPhone(identifier)) setFieldError("identifier", "Enter a valid email or phone number.");
    if (!$password.value) setFieldError("password", "Enter your password.");
    if ($loginForm.querySelector(".field.invalid")) return focusFirstError($loginForm);

    setLoading($submit, true, "Signing in…");
    try {
      const { ok, data } = await postJSON("/api/auth/login", {
        identifier,
        password: $password.value,
        remember: $remember.checked,
      });
      if (ok) return window.location.replace("/");
      showBanner("loginBanner", data.detail || "Could not sign in. Please try again.");
      $password.value = "";
    } catch {
      showBanner("loginBanner", "Could not reach the server. Check your connection and try again.");
    }
    setLoading($submit, false);
    $password.focus();
  });
}

// ==========================================================
// Sign-up page
// ==========================================================

const $accountForm = document.getElementById("accountForm");

if ($accountForm) {
  const $profileForm = document.getElementById("profileForm");
  const $steps = document.getElementById("steps");
  const $stepAccount = document.getElementById("stepAccount");
  const $stepProfile = document.getElementById("stepProfile");
  const $fullName = document.getElementById("full_name");
  const $email = document.getElementById("email");
  const $phoneCode = document.getElementById("phoneCode");
  const $phone = document.getElementById("phone");
  const $password = document.getElementById("new_password");
  const $confirm = document.getElementById("confirm_password");
  const $terms = document.getElementById("terms");
  const $strength = document.getElementById("strength");
  const $strengthLabel = document.getElementById("strengthLabel");
  const $avatarInput = document.getElementById("avatarInput");
  const $avatarPreview = document.getElementById("avatarPreview");
  const $avatarInitials = document.getElementById("avatarInitials");
  const $avatarRemove = document.getElementById("avatarRemove");
  const $avatarDivider = document.getElementById("avatarDivider");
  const $profileSubmit = document.getElementById("profileSubmit");
  const STEP_ONE_FIELDS = ["full_name", "email", "phone", "password"];
  let avatarFile = null;
  let avatarUrl = null;

  function fullPhone() {
    const number = digitsOf($phone.value);
    if (!number) return null;
    return `+${digitsOf($phoneCode.value) || "91"}${number.replace(/^0+/, "")}`;
  }

  function showStep(step) {
    const first = step === 1;
    $accountForm.classList.toggle("hidden", !first);
    $profileForm.classList.toggle("hidden", first);
    $steps.dataset.step = String(step);
    $stepAccount.classList.toggle("active", first);
    $stepAccount.classList.toggle("done", !first);
    $stepAccount.querySelector(".step-dot").innerHTML = first
      ? "1"
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    $stepProfile.classList.toggle("active", !first);
    window.scrollTo({ top: 0 });
    (first ? $fullName : $avatarPreview).focus({ preventScroll: true });
  }

  // -- Password strength --
  const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
  function passwordScore(password) {
    if (!password) return 0;
    const checks = [
      password.length >= 8,
      /\d/.test(password),
      /[^A-Za-z0-9]/.test(password),
      password.length >= 12 || (/[a-z]/.test(password) && /[A-Z]/.test(password)),
    ];
    return Math.max(1, checks.filter(Boolean).length);
  }
  $password.addEventListener("input", () => {
    const score = passwordScore($password.value);
    $strength.dataset.score = String(score);
    $strengthLabel.textContent = STRENGTH_LABELS[score];
  });

  [$fullName, $email, $phone, $password, $confirm].forEach((input) => {
    const name = input.closest("[data-field]").dataset.field;
    input.addEventListener("input", () => setFieldError(name));
  });
  $terms.addEventListener("change", () => setFieldError("terms"));

  function validateAccount() {
    clearFieldErrors($accountForm);
    if (!$fullName.value.trim()) setFieldError("full_name", "Enter your full name.");
    if (!EMAIL_PATTERN.test($email.value.trim())) setFieldError("email", "Enter a valid email address.");
    const phoneDigits = digitsOf($phone.value).length;
    if (phoneDigits && (phoneDigits < 6 || phoneDigits > 14)) setFieldError("phone", "Enter a valid phone number.");
    if (passwordScore($password.value) < 3 || $password.value.length < 8) {
      setFieldError("password", "Use at least 8 characters, with a number and a symbol.");
    }
    if (!$confirm.value) setFieldError("confirm_password", "Repeat your password.");
    else if ($confirm.value !== $password.value) setFieldError("confirm_password", "Passwords don't match.");
    if (!$terms.checked) setFieldError("terms", "Please accept the terms to continue.");
    return !$accountForm.querySelector(".field.invalid");
  }

  function showTaken(field) {
    setFieldError(
      field,
      `An account with this ${field} already exists. <a class="link" href="/login">Sign in instead</a>`,
      true,
    );
  }

  $accountForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showBanner("accountBanner", "");
    if (!validateAccount()) return focusFirstError($accountForm);

    const $submit = document.getElementById("accountSubmit");
    setLoading($submit, true, "Checking…");
    try {
      const { ok, data } = await postJSON("/api/auth/check-availability", {
        email: $email.value.trim(),
        phone: fullPhone(),
      });
      setLoading($submit, false);
      if (!ok) {
        if (data.field) setFieldError(data.field, data.detail);
        else showBanner("accountBanner", data.detail || "Could not check your details.");
        return focusFirstError($accountForm);
      }
      if (data.email) showTaken("email");
      if (data.phone) showTaken("phone");
      if (data.email || data.phone) return focusFirstError($accountForm);
    } catch {
      setLoading($submit, false);
      return showBanner("accountBanner", "Could not reach the server. Check your connection and try again.");
    }

    if (!avatarFile) $avatarInitials.textContent = initialsOf($fullName.value);
    showStep(2);
  });

  // -- Profile photo --
  function setAvatar(file) {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
    avatarFile = file;
    avatarUrl = file ? URL.createObjectURL(file) : null;
    $avatarPreview.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
    $avatarPreview.classList.toggle("has-image", Boolean(file));
    $avatarRemove.classList.toggle("hidden", !file);
    $avatarDivider.classList.toggle("hidden", !file);
    $avatarInitials.textContent = initialsOf($fullName.value);
  }

  const openPicker = () => $avatarInput.click();
  $avatarPreview.addEventListener("click", openPicker);
  document.getElementById("avatarUpload").addEventListener("click", openPicker);
  $avatarRemove.addEventListener("click", () => {
    setAvatar(null);
    setFieldError("avatar");
  });
  $avatarInput.addEventListener("change", () => {
    const file = $avatarInput.files[0];
    $avatarInput.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      return setFieldError("avatar", "The photo must be a JPG or PNG image.");
    }
    if (file.size > MAX_AVATAR_BYTES) return setFieldError("avatar", "The photo must be 2 MB or smaller.");
    setFieldError("avatar");
    setAvatar(file);
  });

  document.getElementById("profileBack").addEventListener("click", () => showStep(1));

  async function register(includeProfile) {
    clearFieldErrors($profileForm);
    showBanner("profileBanner", "");
    const age = document.getElementById("age").value;
    if (includeProfile && age && (Number(age) < 13 || Number(age) > 120)) {
      setFieldError("age", "Enter an age between 13 and 120.");
      return focusFirstError($profileForm);
    }

    const form = new FormData();
    form.append("full_name", $fullName.value.trim());
    form.append("email", $email.value.trim());
    form.append("password", $password.value);
    if (fullPhone()) form.append("phone", fullPhone());
    if (includeProfile) {
      for (const name of ["age", "company", "job_title", "industry"]) {
        const value = document.getElementById(name).value.trim();
        if (value) form.append(name, value);
      }
      if (avatarFile) form.append("avatar", avatarFile);
    }

    setLoading($profileSubmit, true, "Creating account…");
    try {
      const res = await apiFetch(`${BACKEND_URL}/api/auth/register`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return showSuccess(data.user);

      setLoading($profileSubmit, false);
      if (data.field && STEP_ONE_FIELDS.includes(data.field)) {
        showStep(1);
        if (res.status === 409) showTaken(data.field);
        else setFieldError(data.field, data.detail);
        return focusFirstError($accountForm);
      }
      if (data.field) setFieldError(data.field, data.detail);
      else showBanner("profileBanner", typeof data.detail === "string" ? data.detail : "Please check your details and try again.");
      focusFirstError($profileForm);
    } catch {
      setLoading($profileSubmit, false);
      showBanner("profileBanner", "Could not reach the server. Check your connection and try again.");
    }
  }

  function showSuccess(user) {
    document.getElementById("signupCard").classList.add("hidden");
    document.getElementById("successCard").classList.remove("hidden");
    document.getElementById("successWelcome").textContent = `Welcome, ${user.full_name.split(/\s+/)[0]}!`;
    document.querySelector("#successCard a").focus();
  }

  $profileForm.addEventListener("submit", (e) => {
    e.preventDefault();
    register(true);
  });
  document.getElementById("profileSkip").addEventListener("click", () => register(false));
}

// ==========================================================
// Account menu (main app)
// ==========================================================

const $userMenu = document.getElementById("userMenu");

if ($userMenu) {
  const $button = document.getElementById("userMenuButton");
  const $panel = document.getElementById("userMenuPanel");
  const $avatar = document.getElementById("userAvatar");

  function setMenuOpen(open) {
    $panel.classList.toggle("hidden", !open);
    $button.setAttribute("aria-expanded", String(open));
    if (open) $panel.querySelector(".user-menu-item:not(:disabled)").focus();
  }

  $button.addEventListener("click", () => setMenuOpen($panel.classList.contains("hidden")));
  document.addEventListener("click", (e) => {
    if (!$userMenu.contains(e.target)) setMenuOpen(false);
  });
  // Close the menu once one of its actions has been picked.
  $panel.addEventListener("click", (e) => {
    if (e.target.closest(".user-menu-item:not(:disabled)")) setMenuOpen(false);
  });
  $userMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$panel.classList.contains("hidden")) {
      setMenuOpen(false);
      $button.focus();
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await apiFetch(`${BACKEND_URL}/api/auth/logout`, { method: "POST" });
    } finally {
      redirectToLogin();
    }
  });

  (async () => {
    const res = await apiFetch(`${BACKEND_URL}/api/auth/me`);
    if (res.status === 401) return redirectToLogin();
    if (!res.ok) return;
    const { user } = await res.json();
    document.getElementById("userMenuName").textContent = user.full_name;
    document.getElementById("userMenuEmail").textContent = user.email;
    $button.title = [user.full_name, user.job_title, user.company].filter(Boolean).join(" · ");
    if (user.has_avatar) {
      $avatar.style.backgroundImage = `url("${BACKEND_URL}/api/auth/me/avatar")`;
    } else {
      $avatar.textContent = initialsOf(user.full_name);
    }
  })();
}
