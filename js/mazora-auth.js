/* MAZORA account authentication — Supabase Auth only.
   Does not upload IndexedDB books, imported files, journals,
   or reading activity automatically.
*/
(function () {
  "use strict";

  let client = null;
  let mode = "signin";
  let busy = false;
  let recoveryMode = false;

  const $ = id => document.getElementById(id);

  function status(message, isError) {
    const box = $("mazoraAuthStatus");
    if (!box) return;

    box.textContent = message;
    box.style.borderLeft = isError
      ? "3px solid #b94a48"
      : "3px solid #c77a98";
  }

  function setBusy(value) {
    busy = value;

    const button = $("mazoraAuthSubmit");

    if (button) {
      button.disabled = value;
      button.textContent = value
        ? "Please wait…"
        : (mode === "signup" ? "Create account" : "Sign in");
    }
  }

  function setMode(next) {
    mode = next === "signup" ? "signup" : "signin";

    $("mazoraAuthSignInTab")?.classList.toggle(
      "active", mode === "signin"
    );

    $("mazoraAuthSignUpTab")?.classList.toggle(
      "active", mode === "signup"
    );

    if ($("mazoraAuthAlias")) {
      $("mazoraAuthAlias").hidden = mode !== "signup";
    }

    if ($("mazoraAuthAliasLabel")) {
      $("mazoraAuthAliasLabel").hidden = mode !== "signup";
    }

    $("mazoraAuthPassword")?.setAttribute(
      "autocomplete",
      mode === "signup" ? "new-password" : "current-password"
    );

    const submit = $("mazoraAuthSubmit");

    if (submit) {
      submit.textContent = mode === "signup"
        ? "Create account"
        : "Sign in";
    }

    const forgot = $("mazoraAuthForgot");

    if (forgot) {
      forgot.hidden = mode === "signup";
    }
  }

  function renderSession(session) {
    window.MAZORA_AUTH_SIGNED_IN = !!session?.user;

    document.body.classList.toggle(
      "mazora-guest-mode",
      !window.MAZORA_AUTH_SIGNED_IN
    );

    const signedIn = !!session?.user;

    if ($("mazoraAuthGuest")) {
      $("mazoraAuthGuest").hidden = signedIn;
    }

    if ($("mazoraAuthSignedIn")) {
      $("mazoraAuthSignedIn").hidden = !signedIn;
    }

    if ($("mazoraAuthUserEmail")) {
      $("mazoraAuthUserEmail").textContent =
        session?.user?.email || "";
    }

    const pill = $("profileEditToggle");

    if (pill) {
      pill.textContent = signedIn
        ? "MAZORA account"
        : "Guest account";
    }

    if (signedIn) {
      const email = session.user.email || "your account";

      status(
        "You are signed in as " + email +
        ". Your local library remains on this device; cloud sync is not enabled.",
        false
      );
    } else {
      status(
        "Guest mode. Your books and imported files remain stored on this device. Signing in does not upload them.",
        false
      );
    }
  }

  function friendlyError(error) {
    const message = String(
      error?.message || "Something went wrong. Please try again."
    );

    if (/invalid login credentials/i.test(message)) {
      return "Email or password is incorrect.";
    }

    if (/user already registered/i.test(message)) {
      return "An account with this email already exists. Try signing in.";
    }

    if (/password should be at least/i.test(message)) {
      return "Choose a password with at least 8 characters.";
    }

    return message;
  }

  async function submit(event) {
    event.preventDefault();

    if (!client || busy) return;

    const email = $("mazoraAuthEmail")?.value.trim();
    const password = $("mazoraAuthPassword")?.value || "";

    const alias =
      $("mazoraAuthAlias")?.value.trim().slice(0, 30) || "";

    if (!email || !password) {
      return status(
        "Enter your email address and password.",
        true
      );
    }

    if (password.length < 8) {
      return status(
        "Your password must contain at least 8 characters.",
        true
      );
    }

    setBusy(true);

    try {
      if (mode === "signup") {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: alias ? { display_name: alias } : {}
          }
        });

        if (error) throw error;

        if (data.session) {
          renderSession(data.session);

          status(
            "Your MAZORA account has been created and you are signed in.",
            false
          );
        } else {
          status(
            "Registration received. Check your email for the verification link, then return to sign in.",
            false
          );

          setMode("signin");
        }
      } else {
        const { data, error } =
          await client.auth.signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        renderSession(data.session);
      }

      const pass = $("mazoraAuthPassword");

      if (pass) pass.value = "";

    } catch (error) {
      status(friendlyError(error), true);

    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!client) {
      return status(
        "Account service is not configured yet.",
        true
      );
    }

    const email = $("mazoraAuthEmail")?.value.trim();

    if (!email) {
      return status(
        "Enter your email address first, then choose Forgot password.",
        true
      );
    }

    try {
      const redirectTo =
        location.origin && location.origin !== "null"
          ? location.origin + location.pathname
          : undefined;

      const options = redirectTo ? { redirectTo } : {};

      const { error } =
        await client.auth.resetPasswordForEmail(email, options);

      if (error) throw error;

      status(
        "If an account exists for that email, password recovery instructions have been sent.",
        false
      );

    } catch (error) {
      status(friendlyError(error), true);
    }
  }


  function showRecovery(show, message) {
    recoveryMode = !!show;
    const panel = $("mazoraPasswordRecovery");

    if (panel) panel.hidden = !recoveryMode;

    if (recoveryMode) {
      if (typeof window.showPage === "function") {
        window.showPage("profile");
      }

      if ($("mazoraAuthGuest")) $("mazoraAuthGuest").hidden = true;
      if ($("mazoraAuthSignedIn")) $("mazoraAuthSignedIn").hidden = true;
      if (panel) panel.hidden = false;

      if (message && $("mazoraRecoveryMessage")) {
        $("mazoraRecoveryMessage").textContent = message;
      }

      requestAnimationFrame(() => {
        panel?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        $("mazoraNewPassword")?.focus?.();
      });
    }
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    if (!client || busy) return;

    const password = $("mazoraNewPassword")?.value || "";
    const confirm = $("mazoraConfirmPassword")?.value || "";

    if (password.length < 8) {
      return showRecovery(true, "Use at least 8 characters for your password.");
    }

    if (password !== confirm) {
      return showRecovery(true, "The passwords do not match. Please try again.");
    }

    const button = $("mazoraRecoverySubmit");
    busy = true;

    if (button) {
      button.disabled = true;
      button.textContent = "Updating…";
    }

    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;

      $("mazoraNewPassword").value = "";
      $("mazoraConfirmPassword").value = "";

      showRecovery(
        true,
        "Your password has been updated successfully. You can now sign in with your new password."
      );

      if ($("mazoraRecoveryForm")) {
        $("mazoraRecoveryForm").hidden = true;
      }
    } catch (error) {
      showRecovery(true, friendlyError(error));
    } finally {
      busy = false;

      if (button) {
        button.disabled = false;
        button.textContent = "Update password";
      }
    }
  }

  async function signOut() {
    if (!client) return;

    try {
      const { error } = await client.auth.signOut();

      if (error) throw error;

      renderSession(null);

      status(
        "You have signed out. Your local library remains on this device.",
        false
      );

    } catch (error) {
      status(friendlyError(error), true);
    }
  }

  async function init() {
    const cfg = window.MAZORA_SUPABASE_CONFIG;

    if (
      !window.supabase?.createClient ||
      !cfg?.url ||
      !cfg?.publishableKey ||
      /YOUR_|PASTE_YOUR_/i.test(
        cfg.url + cfg.publishableKey
      )
    ) {
      status(
        "Account service is not configured. Check js/supabase-config.js and the Supabase client script.",
        true
      );

      return;
    }

    try {
      client = window.supabase.createClient(
        cfg.url,
        cfg.publishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      );

      $("mazoraAuthForm")?.addEventListener(
        "submit",
        submit
      );

      $("mazoraRecoveryForm")?.addEventListener(
        "submit",
        saveNewPassword
      );

      client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          showRecovery(true, "Enter and confirm your new password below.");
        } else if (!recoveryMode) {
          renderSession(session);
        }
      });

      const { data, error } =
        await client.auth.getSession();

      if (error) throw error;

      renderSession(data.session);

    } catch (error) {
      status(
        "Could not initialize account service: " +
        friendlyError(error),
        true
      );
    }
  }

  window.mazoraAuthSetMode = setMode;
  window.mazoraAuthResetPassword = resetPassword;
  window.mazoraAuthSignOut = signOut;

  // Allows other MAZORA modules to reuse the existing
  // authenticated Supabase client and session.
  window.mazoraGetSupabaseClient = () => client;

  window.addEventListener(
    "DOMContentLoaded",
    init,
    { once: true }
  );

})();
