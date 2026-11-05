
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

let imagePosition = { x: 50, y: 32 };
let textPosition = { x: 50, y: 78 };

let pushListenersReady = false;
let pushRegistrationRunning = false;

// GENERAL HELPERS

const showToast = message => {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2800);
};

const setStatus = (id, message, error = false) => {
  const element = $(id);
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("error", error);
};

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

const isNative = () => Capacitor.isNativePlatform();

function clamp(value, min = 2, max = 98) {
  return Math.min(max, Math.max(min, value));
}

function cleanPosition(position, fallback) {
  return {
    x: clamp(Number(position?.x ?? fallback.x)),
    y: clamp(Number(position?.y ?? fallback.y))
  };
}

// POPUP POSITIONING

function applyPosition(element, position) {
  if (!element) return;

  element.style.left = `${position.x}%`;
  element.style.top = `${position.y}%`;
}

function applyPreviewPositions() {
  applyPosition($("preview-image"), imagePosition);
  applyPosition($("preview-message"), textPosition);
}

function applyDeliveredPositions(data = {}) {
  const imageFallback = { x: 50, y: 32 };
  const textFallback = data.image
    ? { x: 50, y: 78 }
    : { x: 50, y: 50 };

  const savedImagePosition = cleanPosition(
    data.imagePosition,
    imageFallback
  );

  const savedTextPosition = cleanPosition(
    data.textPosition,
    textFallback
  );

  applyPosition($("delivered-image"), savedImagePosition);
  applyPosition($("delivered-message"), savedTextPosition);
}

// DRAGGABLE EDITOR ELEMENTS

function makeDraggable(element, getPosition, setPosition) {
  if (!element) return;

  let dragging = false;
  let pointerId = null;

  element.style.touchAction = "none";
  element.style.userSelect = "none";
  element.style.webkitUserSelect = "none";

  element.addEventListener("pointerdown", event => {
    if (element.hidden) return;

    event.preventDefault();

    dragging = true;
    pointerId = event.pointerId;

    element.classList.add("dragging");

    try {
      element.setPointerCapture(pointerId);
    } catch (_) {}

  });

  element.addEventListener("pointermove", event => {
    if (!dragging || event.pointerId !== pointerId) return;

    const parent = element.parentElement;
    if (!parent) return;

    const rect = parent.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const x = clamp(
      ((event.clientX - rect.left) / rect.width) * 100
    );

    const y = clamp(
      ((event.clientY - rect.top) / rect.height) * 100
    );

    setPosition({ x, y });
    applyPosition(element, getPosition());
  });

  const stopDragging = event => {
    if (!dragging) return;
    if (event.pointerId !== pointerId) return;

    dragging = false;
    pointerId = null;

    element.classList.remove("dragging");
  };

  element.addEventListener("pointerup", stopDragging);
  element.addEventListener("pointercancel", stopDragging);
  element.addEventListener("lostpointercapture", () => {
    dragging = false;
    pointerId = null;
    element.classList.remove("dragging");
  });
}

makeDraggable(
  $("preview-image"),
  () => imagePosition,
  position => {
    imagePosition = position;
  }
);

makeDraggable(
  $("preview-message"),
  () => textPosition,
  position => {
    textPosition = position;
  }
);

applyPreviewPositions();

// AUTH MODE

function setAuthMode(next) {
  mode = next;

  document.querySelectorAll("[data-auth]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.auth === mode
    );
  });

  $("username-wrap").hidden = mode !== "signup";
  $("username").required = mode === "signup";

  $("auth-submit").textContent =
    mode === "signup" ? "Create account" : "Log in";
}

document.querySelectorAll("[data-auth]").forEach(button => {
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.auth);
  });
});

// SIGNUP AND LOGIN

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();

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
        throw new Error(
          "Username must be at least 3 characters."
        );
      }

      const taken = await get(
        ref(db, `usernames/${username}`)
      );

      if (taken.exists()) {
        throw new Error("That username is already taken.");
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await set(
        ref(db, `users/${credential.user.uid}`),
        {
          username,
          email,
          createdAt: Date.now()
        }
      );

      await set(
        ref(db, `usernames/${username}`),
        credential.user.uid
      );

    } else {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
    }

    setStatus("auth-error", "");

  } catch (error) {
    console.error("Authentication error:", error);

    setStatus(
      "auth-error",
      error.message || "Couldn't sign in.",
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
    friends = {};

    if (popupListener) {
      popupListener();
      popupListener = null;
    }

    if (scheduledListener) {
      scheduledListener();
      scheduledListener = null;
    }

    $("notification-status").textContent =
      isNative()
        ? "Enable notifications to receive surprises."
        : "Notifications are available in the Android app.";

    return;
  }

  try {
    console.log("Initializing Poply:", user.uid);

    const snap = await get(
      ref(db, `users/${user.uid}`)
    );

    profile = snap.val() || {};

    $("session-label").textContent =
      `@${profile.username || "user"}`;

    $("account-name").textContent =
      `@${profile.username || "user"}`;

    $("account-email").textContent =
      user.email || "";

    watchIncoming();
    watchScheduled();

    await loadFriends();

    $("notification-status").textContent =
      isNative()
        ? "Tap Enable notifications to turn them on."
        : "Notifications are available in the Android app.";

    console.log("Poply initialized successfully.");

  } catch (error) {
    console.error("App initialization failed:", error);

    showToast(
      "App initialization error: " + error.message
    );
  }
});

// NOTIFICATION SETUP

async function setupPushListeners() {
  if (pushListenersReady) return;

  await PushNotifications.addListener(
    "registration",
    async token => {
      try {
        if (!currentUser) return;

        await set(
          ref(
            db,
            `tokens/${currentUser.uid}/${encodeURIComponent(token.value)}`
          ),
          true
        );

        $("notification-status").textContent =
          "Push notifications enabled.";

        showToast("Notifications enabled.");

      } catch (error) {
        console.error("Saving push token failed:", error);
        showToast("Couldn't save notification token.");
      }
    }
  );

  await PushNotifications.addListener(
    "registrationError",
    error => {
      console.error("Push registration error:", error);

      $("notification-status").textContent =
        "Push registration failed. Check Firebase setup.";

      showToast("Push registration failed.");
    }
  );

  await PushNotifications.addListener(
    "pushNotificationReceived",
    notification => {
      console.log("Push received:", notification);

      const popupId = notification.data?.popupId;

      if (popupId) {
        showDeliveredPopup(popupId).catch(console.error);
      }
    }
  );

  await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    async action => {
      try {
        const popupId =
          action.notification.data?.popupId;

        if (popupId) {
          await showDeliveredPopup(popupId);
        }
      } catch (error) {
        console.error("Push action error:", error);
      }
    }
  );

  pushListenersReady = true;
}

async function requestLocalNotificationPermission() {
  if (!isNative()) {
    throw new Error(
      "Local notifications require the Android app."
    );
  }

  let permission =
    await LocalNotifications.checkPermissions();

  if (permission.display !== "granted") {
    permission =
      await LocalNotifications.requestPermissions();
  }

  if (permission.display !== "granted") {
    throw new Error(
      "Allow notifications in Android settings first."
    );
  }

  return true;
}

async function registerPush() {
  if (!isNative()) {
    showToast(
      "Install the Android app to enable notifications."
    );
    return;
  }

  if (pushRegistrationRunning) return;

  pushRegistrationRunning = true;

  const button = $("enable-notifications");

  if (button) button.disabled = true;

  try {
    await requestLocalNotificationPermission();

    await setupPushListeners();

    let permission =
      await PushNotifications.checkPermissions();

    if (permission.receive !== "granted") {
      permission =
        await PushNotifications.requestPermissions();
    }

    if (permission.receive !== "granted") {
      $("notification-status").textContent =
        "Notification permission was not granted.";

      throw new Error(
        "Allow push notifications in Android settings."
      );
    }

    await PushNotifications.register();

    $("notification-status").textContent =
      "Notification permission granted. Connecting to push service...";

  } catch (error) {
    console.error("Notification setup error:", error);

    $("notification-status").textContent =
      error.message || "Notification setup failed.";

    showToast(error.message || "Notification setup failed.");

  } finally {
    pushRegistrationRunning = false;

    if (button) button.disabled = false;
  }
}

$("enable-notifications").addEventListener(
  "click",
  registerPush
);

// LOCAL NOTIFICATION TAP HANDLER

LocalNotifications.addListener(
  "localNotificationActionPerformed",
  async action => {
    try {
      const payload =
        action.notification.extra?.poplyPayload;

      if (payload) {
        showPopupData(payload);
      }
    } catch (error) {
      console.error(
        "Local notification action error:",
        error
      );
    }
  }
).catch(error => {
  console.error(
    "Local notification listener error:",
    error
  );
});

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

    error => {
      console.error("Inbox listener error:", error);
    }
  );
}

// SCHEDULED POPUPS

function watchScheduled() {
  if (scheduledListener) scheduledListener();

  scheduledListener = onValue(
    ref(db, `schedules/${currentUser.uid}`),

    snap => {
      const entries = Object.entries(snap.val() || {})
        .sort(
          (a, b) => (a[1].at || 0) - (b[1].at || 0)
        );

      $("scheduled-list").innerHTML = entries.length
        ? entries.map(([id, popup]) => `
          <div class="list-card">
            <div class="list-main">
              <strong>${escapeHtml(
                popup.message || "Image pop-up"
              )}</strong>
              <span class="muted">
                ${new Date(popup.at).toLocaleString()}
                · ${popup.to === currentUser.uid ? "You" : "Friend"}
              </span>
            </div>
            <button
              class="small danger-text"
              data-cancel="${id}"
            >
              Cancel
            </button>
          </div>
        `).join("")
        : `<p class="muted">Nothing scheduled yet.</p>`;

      document.querySelectorAll("[data-cancel]").forEach(button => {
        button.addEventListener("click", () => {
          cancelSchedule(button.dataset.cancel);
        });
      });
    },

    error => {
      console.error("Schedule listener error:", error);
    }
  );
}

async function cancelSchedule(id) {
  try {
    const item = (
      await get(
        ref(db, `schedules/${currentUser.uid}/${id}`)
      )
    ).val();

    if (
      item?.localNotificationId &&
      isNative()
    ) {
      await LocalNotifications.cancel({
        notifications: [{
          id: item.localNotificationId
        }]
      });
    }

    await remove(
      ref(db, `schedules/${currentUser.uid}/${id}`)
    );

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

$("text-color").addEventListener("input", event => {
  $("preview-message").style.color =
    event.target.value;
});

$("accent-color").addEventListener("input", event => {
  $("popup-preview").style.setProperty(
    "--accent",
    event.target.value
  );
});

$("popup-image").addEventListener("change", async event => {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    return showToast("Choose an image file.");
  }

  if (file.size > 8 * 1024 * 1024) {
    return showToast(
      "Choose an image smaller than 8 MB."
    );
  }

  try {
    imageData = await resizeImage(file);

    $("preview-image").src = imageData;
    $("preview-image").hidden = false;

    // Put the message lower when an image is added.
    if (textPosition.y === 50) {
      textPosition = { x: 50, y: 78 };
    }

    applyPreviewPositions();

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

        canvas.width = Math.max(
          1,
          Math.round(img.width * scale)
        );

        canvas.height = Math.max(
          1,
          Math.round(img.height * scale)
        );

        const context = canvas.getContext("2d");

        context.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        // PNG transparency is preserved.
        context.drawImage(
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

// RESET EDITOR AFTER SCHEDULING

function resetEditor() {
  imageData = "";

  imagePosition = { x: 50, y: 32 };
  textPosition = { x: 50, y: 50 };

  $("popup-message").value = "";
  $("popup-image").value = "";

  $("preview-image").src = "";
  $("preview-image").hidden = true;

  $("preview-message").textContent =
    "A little surprise ✨";

  $("preview-message").style.color =
    $("text-color").value;

  applyPreviewPositions();
}

// SCHEDULE BUTTON

$("schedule-btn").addEventListener(
  "click",
  async () => {
    if (!currentUser) return;

    const message =
      $("popup-message").value.trim();

    if (!message && !imageData) {
      return setStatus(
        "editor-status",
        "Add a message or an image.",
        true
      );
    }

    const at = new Date(
      $("schedule-at").value
    ).getTime();

    if (
      !Number.isFinite(at) ||
      at < Date.now() + 5000
    ) {
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

      // Save the exact editor layout.
      imagePosition: {
        ...imagePosition
      },

      textPosition: {
        ...textPosition
      },

      at,
      createdAt: Date.now(),
      status: "pending"
    };

    try {
      $("schedule-btn").disabled = true;

      if (isSelf) {
        if (!isNative()) {
          throw new Error(
            "Local scheduling requires the Android app."
          );
        }

        await requestLocalNotificationPermission();

        const id = Math.floor(
          Date.now() / 1000
        ) % 2147483000;

        await LocalNotifications.schedule({
          notifications: [{
            id,

            title: "A Poply surprise ✨",

            body: message ||
              "You have an image surprise.",

            schedule: {
              at: new Date(at)
            },

            extra: {
              poplyPayload: payload
            }
          }]
        });

        const record = push(
          ref(db, `schedules/${currentUser.uid}`)
        );

        await set(record, {
          ...payload,
          localNotificationId: id
        });

        setStatus(
          "editor-status",
          "Your pop-up is scheduled."
        );

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

      resetEditor();

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
  }
);

// DISPLAY POPUPS

function showPopupData(data, id = null) {
  activePopupId = id;

  $("delivered-message").textContent =
    data.message || "";

  $("delivered-message").style.color =
    data.textColor || "#fff";

  $("delivered-image").hidden = !data.image;

  if (data.image) {
    $("delivered-image").src = data.image;
  } else {
    $("delivered-image").src = "";
  }

  document.querySelector(".popup-card")?.style.setProperty(
    "--accent",
    data.accent || "#a78bfa"
  );

  applyDeliveredPositions(data);

  $("popup-overlay").hidden = false;
}

async function showDeliveredPopup(id) {
  if (!currentUser) return;

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

$("popup-overlay").addEventListener("click", event => {
  if (event.target === $("popup-overlay")) {
    $("popup-overlay").hidden = true;
  }
});

//FRIEND SEARCH

$("friend-search-btn").addEventListener(
  "click",
  async () => {
    const name = $("friend-search").value
      .trim()
      .toLowerCase();

    if (!name) return;

    try {
      const snap = await get(
        ref(db, `usernames/${name}`)
      );

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

      const userSnap = await get(
        ref(db, `users/${uid}`)
      );

      const user = userSnap.val() || {};

      $("friend-search-result").innerHTML = `
        <div class="list-card">
          <span>
            @${escapeHtml(user.username || "user")}
          </span>
          <button
            id="send-request"
            class="small secondary"
          >
            Add friend
          </button>
        </div>
      `;

      $("send-request").addEventListener(
        "click",
        async () => {
          try {
            await set(
              ref(
                db,
                `friendRequests/${uid}/${currentUser.uid}`
              ),
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
        }
      );

    } catch (error) {
      showToast(error.message);
    }
  }
);

// ACCEPT FRIEND REQUEST

async function acceptFriend(fromUid) {
  try {
    const request = (
      await get(
        ref(
          db,
          `friendRequests/${currentUser.uid}/${fromUid}`
        )
      )
    ).val();

    if (!request) return;

    await set(
      ref(db, `friends/${currentUser.uid}/${fromUid}`),
      {
        username: request.username
      }
    );

    await set(
      ref(db, `friends/${fromUid}/${currentUser.uid}`),
      {
        username: profile.username
      }
    );

    await remove(
      ref(
        db,
        `friendRequests/${currentUser.uid}/${fromUid}`
      )
    );

    await loadFriends();

    showToast("Friend added.");

  } catch (error) {
    showToast(error.message);
  }
}

// PAGE NAVIGATION

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-page]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    document.querySelectorAll(".page").forEach(page => {
      page.hidden =
        page.id !== `page-${button.dataset.page}`;
    });

    if (button.dataset.page === "friends") {
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

if (!isNative()) {
  $("notification-status").textContent =
    "Push notifications are available in the Android app.";
}
