const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();

// Runs once a minute. Friend schedules are sent as visible push notifications.
// Tapping the notification opens the scheduled custom pop-up in Poply.
exports.deliverScheduledPopups = onSchedule("every 1 minutes", async () => {
  const now = Date.now();
  const snap = await db.ref("schedules").get();
  if (!snap.exists()) return;
  const jobs = [];
  snap.forEach(owner => {
    owner.forEach(item => {
      const p = item.val();
      if (p && p.status === "pending" && p.to && p.to !== p.from && p.at <= now) {
        jobs.push({ owner: owner.key, id: item.key, popup: p });
      }
    });
  });
  for (const job of jobs) {
    const lock = db.ref(`schedules/${job.owner}/${job.id}`);
    const latest = await lock.get();
    if (!latest.exists() || latest.val().status !== "pending") continue;
    const friendship = await db.ref(`friends/${job.popup.from}/${job.popup.to}`).get();
    if (!friendship.exists()) {
      await lock.update({ status: "rejected", lastError: "Recipient is not an accepted friend." });
      continue;
    }
    await lock.update({ status: "sending" });
    try {
      const tokenSnap = await db.ref(`tokens/${job.popup.to}`).get();
      const tokens = Object.keys(tokenSnap.val() || {});
      const decodedTokens = tokens.map(t => decodeURIComponent(t));
      if (decodedTokens.length) {
        await admin.messaging().sendEachForMulticast({
          tokens: decodedTokens,
          notification: {
            title: "A Poply surprise ✨",
            body: job.popup.message || "Someone sent you an image surprise."
          },
          data: { popupId: job.id, senderId: job.popup.from, type: "poply_popup" },
          android: { priority: "high", notification: { channelId: "poply" } }
        });
      }
      await db.ref(`inbox/${job.popup.to}/${job.id}`).set({
        ...job.popup, status: "delivered", seen: false
      });
      await lock.update({ status: "sent", sentAt: now });
    } catch (error) {
      await lock.update({ status: "pending", lastError: String(error).slice(0, 300) });
      console.error("Poply delivery failed", job.id, error);
    }
  }
});
