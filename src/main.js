
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";

import {
  ref, get, set, update, push, onValue, remove
} from "firebase/database";

import { auth, db, firebaseConfigured } from "./firebase.js";
import "./style.css";

const $ = id => document.getElementById(id);

let mode = "signup";
let currentUser = null;
let profile = null;
let friends = {};
let imageData = "";
let popupListener = null;
let scheduledListener = null;
let activePopupId = null;

const showToast = message => {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2800);
};

const setStatus = (id, message, error = false) => {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
};

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

// AUTH MODE

function setAuthMode(next) {
  mode = next;

  document.querySelectorAll("[data-auth]").forEach(b => {
    b.classList.toggle("active", b.dataset.auth === mode);
  });

  $("username-wrap").hidden = mode !== "signup";
  $("username").required = mode === "signup";
  $("auth-submit").textContent =
    mode === "signup" ? "Create account" : "Log in";
}

document.querySelectorAll("[data-auth]").forEach(b => {
  b.addEventListener("click", () => setAuthMode(b.dataset.auth));
});

// SIGNUP AND LOGIN

$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();

  if (!firebaseConfigured) {
    return setStatus(
      "auth-error",
      "Check your Firebase configuration.",
      true
    );
  }

  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  const username = $("username").value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  try {
    $("auth-submit").disabled = true;

    if (mode === "signup") {
      if (username.length < 3) {
        throw new Error("Username must be at least 3 characters.");
      }

      const taken = await get(ref(db, `usernames/${username}`));

      if (taken.exists()) {
        throw new Error("That username is already taken.");
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await set(ref(db, `users/${credential.user.uid}`), {
        username,
        email,
        createdAt: Date.now()
      });

      await set(
        ref(db, `usernames/${username}`),
        credential.user.uid
      );

    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    setStatus("auth-error", "");

  } catch (err) {
    console.error("Authentication error:", err);

    setStatus(
      "auth-error",
      err.message || "Couldn't sign in.",
      true
    );

  } finally {
    $("auth-submit").disabled = false;
  }
});

// AUTH STATE AND APP INITIALIZATION

onAuthStateChanged(auth, async user => {
  currentUser = user;

  $("auth-view").hidden = !!user;
  $("app-view").hidden = !user;

  if (!user) {
    profile = null;

    if (popupListener) {
      popupListener();
      popupListener = null;
    }

    if (scheduledListener) {
      scheduledListener();
      scheduledListener = null;
    }

    return;
  }

  try {
    console.log("Initializing Poply for:", user.uid);

    const snap = await get(ref(db, `users/${user.uid}`));

    profile = snap.val() || {};

    $("session-label").textContent =
      `@${profile.username || "user"}`;

    $("account-name").textContent =
      `@${profile.username || "user"}`;

    $("account-email").textContent = user.email || "";

    // PUSH REGISTRATION TEMPORARILY DISABLED.
    // We will restore it after testing the app startup.

    $("notification-status").textContent =
      "Push notifications temporarily disabled for testing.";

    watchIncoming();
    watchScheduled();

    await loadFriends();

    console.log("Poply initialized successfully.");

  } catch (error) {
    console.error("App initialization failed:", error);

    showToast("App initialization error: " + error.message);
  }
});

// PUSH REGISTRATION
// Not called during this testing phase.

async function registerPush() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    let perm = await PushNotifications.checkPermissions();

    if (perm.receive !== "granted") {
      perm = await PushNotifications.requestPermissions();
    }

    if (perm.receive !== "granted") return;

    await PushNotifications.register();

    PushNotifications.addListener("registration", async token => {
      if (!currentUser) return;

      await set(
        ref(db, `tokens/${currentUser.uid}/${encodeURIComponent(token.value)}`),
        true
      );

      $("notification-status").textContent =
        "Notifications enabled.";
    });

    PushNotifications.addListener("registrationError", e => {
      console.error("Push registration error:", e);
    });

    PushNotifications.addListener(
      "pushNotificationActionPerformed",
      async action => {
        const popupId = action.notification.data?.popupId;

        if (popupId) {
          await showDeliveredPopup(popupId);
        }
      }
    );

  } catch (error) {
    console.error("Push setup error:", error);
  }
}

$("enable-notifications").addEventListener("click", registerPush);

// INCOMING POPUPS

function watchIncoming() {
  if (popupListener) popupListener();

  popupListener = onValue(
    ref(db, `inbox/${currentUser.uid}`),

    async snap => {
      try {
        const entries = snap.val() || {};

        for (const [id, item] of Object.entries(entries)) {
          if (item.status === "delivered" && !item.seen) {
            await update(
              ref(db, `inbox/${currentUser.uid}/${id}`),
              { seen: true }
            );

            showPopupData(item, id);
          }
        }
      } catch (error) {
        console.error("Incoming popup error:", error);
      }
    },

    error => console.error("Inbox listener error:", error)
  );
}

// SCHEDULED POPUPS

function watchScheduled() {
  if (scheduledListener) scheduledListener();

  scheduledListener = onValue(
    ref(db, `schedules/${currentUser.uid}`),

    snap => {
      const entries = Object.entries(snap.val() || {})
        .sort((a, b) => (a[1].at || 0) - (b[1].at || 0));

      $("scheduled-list").innerHTML = entries.length
        ? entries.map(([id, p]) => `
          <div class="list-card">
            <div class="list-main">
              <strong>${escapeHtml(p.message || "Image pop-up")}</strong>
              <span class="muted">
                ${new Date(p.at).toLocaleString()}
                · ${p.to === currentUser.uid ? "You" : "Friend"}
              </span>
            </div>
            <button class="small danger-text" data-cancel="${id}">
              Cancel
            </button>
          </div>
        `).join("")
        : `<p class="muted">Nothing scheduled yet.</p>`;

      document.querySelectorAll("[data-cancel]").forEach(b => {
        b.addEventListener("click", () =>
          cancelSchedule(b.dataset.cancel)
        );
      });
    },

    error => console.error("Schedule listener error:", error)
  );
}

async function cancelSchedule(id) {
  try {
    const item = (
      await get(ref(db, `schedules/${currentUser.uid}/${id}`))
    ).val();

    if (item?.localNotificationId && Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({
        notifications: [{ id: item.localNotificationId }]
      });
    }

    await remove(ref(db, `schedules/${currentUser.uid}/${id}`));

    showToast("Schedule cancelled.");

  } catch (error) {
    showToast(error.message);
  }
}

// IMAGE EDITOR

$("popup-message").addEventListener("input", () => {
  $("preview-message").textContent =
    $("popup-message").value || "A little surprise ✨";
});

$("text-color").addEventListener("input", e => {
  $("preview-message").style.color = e.target.value;
});

$("accent-color").addEventListener("input", e => {
  $("popup-preview").style.setProperty("--accent", e.target.value);
});

$("popup-image").addEventListener("change", async e => {
  const file = e.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    return showToast("Choose an image file.");
  }

  if (file.size > 8 * 1024 * 1024) {
    return showToast("Choose an image smaller than 8 MB.");
  }

  try {
    imageData = await resizeImage(file);

    $("preview-image").src = imageData;
    $("preview-image").hidden = false;

  } catch (error) {
    console.error(error);
    showToast("Couldn't read that image.");
  }
});

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = reject;

    reader.onload = () => {
      const img = new Image();

      img.onerror = reject;

      img.onload = () => {
        const max = 900;

        const scale = Math.min(
          1,
          max / Math.max(img.width, img.height)
        );

        const canvas = document.createElement("canvas");

        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext("2d");

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.drawImage(
          img,
          0,
          0,
          canvas.width,
          canvas.height
        );

        resolve(canvas.toDataURL("image/png"));
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

// SCHEDULE BUTTON

$("schedule-btn").addEventListener("click", async () => {
  if (!currentUser) return;

  const message = $("popup-message").value.trim();

  if (!message && !imageData) {
    return setStatus(
      "editor-status",
      "Add a message or an image.",
      true
    );
  }

  const at = new Date($("schedule-at").value).getTime();

  if (!Number.isFinite(at) || at < Date.now() + 5000) {
    return setStatus(
      "editor-status",
      "Choose a time at least 5 seconds in the future.",
      true
    );
  }

  const to = $("recipient").value;
  const isSelf = to === "self";

  const payload = {
    from: currentUser.uid,
    to: isSelf ? currentUser.uid : to,
    message,
    image: imageData || null,
    textColor: $("text-color").value,
    accent: $("accent-color").value,
    at,
    createdAt: Date.now(),
    status: "pending"
  };

  try {
    $("schedule-btn").disabled = true;

    if (isSelf) {
      if (!Capacitor.isNativePlatform()) {
        throw new Error("Local scheduling requires the Android app.");
      }

      const id = Math.floor(Date.now() / 1000) % 2147483000;

      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: "A Poply surprise ✨",
          body: message || "You have an image surprise.",
          schedule: { at: new Date(at) },
          extra: { poplyPayload: payload }
        }]
      });

      const record = push(
        ref(db, `schedules/${currentUser.uid}`)
      );

      await set(record, {
        ...payload,
        localNotificationId: id
      });

      setStatus("editor-status", "Your pop-up is scheduled.");

    } else {
      const record = push(
        ref(db, `schedules/${currentUser.uid}`)
      );

      await set(record, {
        ...payload,
        scheduleId: record.key
      });

      setStatus(
        "editor-status",
        "Friend's pop-up scheduled."
      );
    }

    $("popup-message").value = "";
    imageData = "";
    $("popup-image").value = "";
    $("preview-image").hidden = true;
    $("preview-message").textContent = "A little surprise ✨";

  } catch (error) {
    console.error("Schedule error:", error);

    setStatus(
      "editor-status",
      error.message || "Couldn't schedule pop-up.",
      true
    );

  } finally {
    $("schedule-btn").disabled = false;
  }
});

// LOCAL NOTIFICATION CLICK

LocalNotifications.addListener(
  "localNotificationActionPerformed",
  async action => {
    try {
      const payload = action.notification.extra?.poplyPayload;

      if (payload) showPopupData(payload);

    } catch (error) {
      console.error("Local notification action error:", error);
    }
  }
).catch(error => {
  console.error("Local notification listener error:", error);
});

// DISPLAY POPUPS

function showPopupData(data, id = null) {
  activePopupId = id;

  $("delivered-message").textContent = data.message || "";

  $("delivered-message").style.color =
    data.textColor || "#fff";

  $("delivered-image").hidden = !data.image;

  if (data.image) {
    $("delivered-image").src = data.image;
  }

  $("popup-overlay").hidden = false;
}

async function showDeliveredPopup(id) {
  const snap = await get(
    ref(db, `inbox/${currentUser.uid}/${id}`)
  );

  if (snap.exists()) {
    showPopupData(snap.val(), id);
  }
}

$("close-popup").addEventListener("click", () => {
  $("popup-overlay").hidden = true;
});

$("popup-overlay").addEventListener("click", e => {
  if (e.target === $("popup-overlay")) {
    $("popup-overlay").hidden = true;
  }
});

// FRIENDS

async function loadFriends() {
  const [friendSnap, requestSnap] = await Promise.all([
    get(ref(db, `friends/${currentUser.uid}`)),
    get(ref(db, `friendRequests/${currentUser.uid}`))
  ]);

  friends = friendSnap.val() || {};

  $("friends-list").innerHTML =
    Object.keys(friends).length
      ? Object.keys(friends).map(uid => `
          <div class="list-card">
            <span>@${escapeHtml(friends[uid].username || "friend")}</span>
          </div>
        `).join("")
      : `<p class="muted">No friends yet.</p>`;

  const requests = requestSnap.val() || {};

  $("requests-list").innerHTML =
    Object.entries(requests).map(([id, r]) => `
      <div class="list-card">
        <span>@${escapeHtml(r.username || "someone")}</span>
        <button class="small secondary" data-accept="${id}">
          Accept
        </button>
      </div>
    `).join("") || `<p class="muted">No pending requests.</p>`;

  document.querySelectorAll("[data-accept]").forEach(b => {
    b.addEventListener("click", () =>
      acceptFriend(b.dataset.accept)
    );
  });

  $("recipient").innerHTML =
    `<option value="self">Myself</option>` +
    Object.entries(friends).map(([uid, f]) => `
      <option value="${uid}">
        @${escapeHtml(f.username)}
      </option>
    `).join("");
}

// FRIEND SEARCH

$("friend-search-btn").addEventListener("click", async () => {
  const name = $("friend-search").value.trim().toLowerCase();

  if (!name) return;

  try {
    const snap = await get(ref(db, `usernames/${name}`));

    if (!snap.exists()) {
      $("friend-search-result").innerHTML =
        `<p class="muted">No user found.</p>`;
      return;
    }

    const uid = snap.val();

    if (uid === currentUser.uid) {
      $("friend-search-result").innerHTML =
        `<p class="muted">That's you!</p>`;
      return;
    }

    const userSnap = await get(ref(db, `users/${uid}`));
    const u = userSnap.val() || {};

    $("friend-search-result").innerHTML = `
      <div class="list-card">
        <span>@${escapeHtml(u.username)}</span>
        <button id="send-request" class="small secondary">
          Add friend
        </button>
      </div>
    `;

    $("send-request").addEventListener("click", async () => {
      try {
        await set(
          ref(db, `friendRequests/${uid}/${currentUser.uid}`),
          {
            username: profile.username,
            from: currentUser.uid,
            at: Date.now()
          }
        );

        showToast("Friend request sent.");

      } catch (error) {
        showToast(error.message);
      }
    });

  } catch (error) {
    showToast(error.message);
  }
});

// ACCEPT FRIEND REQUEST

async function acceptFriend(fromUid) {
  try {
    const request = (
      await get(
        ref(db, `friendRequests/${currentUser.uid}/${fromUid}`)
      )
    ).val();

    if (!request) return;

    await set(
      ref(db, `friends/${currentUser.uid}/${fromUid}`),
      { username: request.username }
    );

    await set(
      ref(db, `friends/${fromUid}/${currentUser.uid}`),
      { username: profile.username }
    );

    await remove(
      ref(db, `friendRequests/${currentUser.uid}/${fromUid}`)
    );

    await loadFriends();

    showToast("Friend added.");

  } catch (error) {
    showToast(error.message);
  }
}

// PAGE NAVIGATION

document.querySelectorAll("[data-page]").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-page]").forEach(x => {
      x.classList.toggle("active", x === b);
    });

    document.querySelectorAll(".page").forEach(p => {
      p.hidden = p.id !== `page-${b.dataset.page}`;
    });

    if (b.dataset.page === "friends") {
      loadFriends().catch(error => {
        console.error("Friend loading error:", error);
        showToast(error.message);
      });
    }
  });
});

// LOGOUT

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showToast(error.message);
  }
});

// WEB VERSION NOTICE

if (!Capacitor.isNativePlatform()) {
  $("notification-status").textContent =
    "Push notifications are available in the Android app.";
}
