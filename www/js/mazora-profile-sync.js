/* MAZORA secure cross-device account profile synchronization */
(function () {
  "use strict";

  const BUCKET = "mazora-profile-photos";
  const TABLE = "mazora_profiles";
  const PHOTO_URL_LIFETIME = 3600;
  const PHOTO_REFRESH_MS = 50 * 60 * 1000;

  let client = null;
  let currentUser = null;
  let profile = null;
  let photoUrl = "";
  let loadVersion = 0;
  let photoRefreshTimer = null;

  function getClient() {
    return window.mazoraGetSupabaseClient?.() || null;
  }

  function notify() {
    if (typeof window.refreshProfileIdentity === "function") {
      window.refreshProfileIdentity();
    }

    document.dispatchEvent(new CustomEvent("mazora:profile-updated"));
  }

  function getFallbackName(user) {
    return (
      user?.user_metadata?.display_name ||
      user?.email?.split("@")[0] ||
      "Reader"
    ).slice(0, 30);
  }

  function clearPhotoTimer() {
    if (photoRefreshTimer) {
      clearTimeout(photoRefreshTimer);
      photoRefreshTimer = null;
    }
  }

  function isCurrent(version, userId) {
    return (
      loadVersion === version &&
      currentUser?.id === userId
    );
  }

  async function refreshPhotoUrl(version, userId) {
    if (!client || !isCurrent(version, userId)) return;

    const path = profile?.avatar_path;

    if (!path) {
      photoUrl = "";
      notify();
      return;
    }

    try {
      const { data, error } = await client.storage
        .from(BUCKET)
        .createSignedUrl(path, PHOTO_URL_LIFETIME);

      if (error) throw error;
      if (!isCurrent(version, userId)) return;

      photoUrl = data?.signedUrl || "";
      notify();

      clearPhotoTimer();
      photoRefreshTimer = setTimeout(() => {
        refreshPhotoUrl(version, userId);
      }, PHOTO_REFRESH_MS);

    } catch (error) {
      console.error("MAZORA profile photo refresh failed:", error);
    }
  }

  async function loadProfile(user) {
    const version = ++loadVersion;

    clearPhotoTimer();

    if (!user) {
      currentUser = null;
      profile = null;
      photoUrl = "";
      notify();
      return;
    }

    const activeClient = getClient();
    if (!activeClient) return;

    client = activeClient;
    currentUser = user;
    profile = null;
    photoUrl = "";

    // Clear the previous account's identity immediately.
    notify();

    try {
      const { data, error } = await client
        .from(TABLE)
        .select("user_id,display_name,avatar_path")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!isCurrent(version, user.id)) return;
      if (error) throw error;

      if (data) {
        profile = data;
      } else {
        const initialProfile = {
          user_id: user.id,
          display_name: getFallbackName(user),
          avatar_path: null
        };

        const { data: created, error: createError } = await client
          .from(TABLE)
          .upsert(initialProfile, { onConflict: "user_id" })
          .select()
          .single();

        if (!isCurrent(version, user.id)) return;
        if (createError) throw createError;

        profile = created;
      }

      if (profile?.avatar_path) {
        await refreshPhotoUrl(version, user.id);
      } else {
        notify();
      }

    } catch (error) {
      if (!isCurrent(version, user.id)) return;
      console.error("MAZORA profile loading failed:", error);
      notify();
    }
  }

  async function saveName(value) {
    if (!currentUser || !client) {
      throw new Error("Please sign in before saving your account name.");
    }

    const userId = currentUser.id;
    const displayName = String(value || "").trim().slice(0, 30);

    if (!displayName) {
      throw new Error("Please enter a valid reader name.");
    }

    const { data, error } = await client
      .from(TABLE)
      .upsert({
        user_id: userId,
        display_name: displayName,
        avatar_path: profile?.avatar_path || null,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;

    if (currentUser?.id === userId) {
      profile = data;
      notify();
    }

    return true;
  }

  async function uploadAvatar(blob) {
    if (!currentUser || !client) {
      throw new Error("Please sign in before synchronizing a profile photo.");
    }

    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error("The selected profile photo is empty.");
    }

    if (blob.size > 2 * 1024 * 1024) {
      throw new Error("The resized profile photo must be under 2 MB.");
    }

    const user = currentUser;
    const userId = user.id;
    const path = userId + "/avatar.jpg";

    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(path, blob, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "3600"
      });

    if (uploadError) throw uploadError;

    const { data, error } = await client
      .from(TABLE)
      .upsert({
        user_id: userId,
        display_name: profile?.display_name || getFallbackName(user),
        avatar_path: path,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;

    if (currentUser?.id === userId) {
      profile = data;
      const version = loadVersion;
      await refreshPhotoUrl(version, userId);
    }

    return true;
  }

  async function deleteAvatar() {
    if (!currentUser || !client) return false;

    const userId = currentUser.id;
    const oldPath = profile?.avatar_path;

    const { data, error } = await client
      .from(TABLE)
      .upsert({
        user_id: userId,
        display_name: profile?.display_name || getFallbackName(currentUser),
        avatar_path: null,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;

    if (currentUser?.id !== userId) return true;

    profile = data;
    photoUrl = "";
    clearPhotoTimer();
    notify();

    if (oldPath) {
      const { error: removeError } = await client.storage
        .from(BUCKET)
        .remove([oldPath]);

      if (removeError) {
        console.warn("Old profile photo could not be removed:", removeError);
      }
    }

    return true;
  }

  function handleAuthChange(session) {
    const user = session?.user || null;

    if (!user) {
      if (currentUser) loadProfile(null);
      return;
    }

    if (currentUser?.id !== user.id) {
      loadProfile(user);
    } else {
      currentUser = user;
    }
  }

  window.MAZORA_PROFILE_SYNC = {
    loadProfile,
    saveName,
    uploadAvatar,
    deleteAvatar,
    getProfile: () => profile,
    getPhotoUrl: () => photoUrl,
    getEmail: () => currentUser?.email || "",
    isSignedIn: () => !!currentUser
  };

  function initialize() {
    client = getClient();

    if (!client) {
      console.warn("MAZORA profile sync: Supabase client unavailable.");
      return;
    }

    client.auth.onAuthStateChange((_event, session) => {
      // Run profile/database work after the auth callback completes.
      setTimeout(() => handleAuthChange(session), 0);
    });

    client.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        handleAuthChange(data.session);
      })
      .catch(error => {
        console.error("MAZORA profile session check failed:", error);
      });

    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        currentUser &&
        profile?.avatar_path
      ) {
        refreshPhotoUrl(loadVersion, currentUser.id);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    // Let the deferred authentication script initialize its client first.
    setTimeout(initialize, 0);
  }
})();
