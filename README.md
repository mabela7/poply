# Poply — Capacitor Android project

A dark, image-first pop-up scheduler. The project is designed for the phone → GitHub mobile website → GitHub Actions APK workflow.

## Included
- Email/password signup and login
- Unique username lookup and friend requests
- Custom message and gallery image editor
- PNG transparency preserved by the preview/editor
- Schedule to yourself or a friend
- Local notification scheduling for yourself
- Firebase scheduled delivery function for friends
- GitHub Actions debug APK workflow

## Important platform behavior
- A custom in-app pop-up can appear while Poply is open.
- When Poply is closed, Android displays a normal push/local notification. The user taps it to open the custom pop-up.
- Android does not allow an ordinary app to silently draw arbitrary pop-ups over other apps or silently activate the camera/microphone.
- The receiver needs Poply installed, an account, and notifications enabled to receive scheduled friend pop-ups.
- The included friend delivery function checks schedules every minute. Delivery timing depends on push delivery and Android notification settings; it is not a guaranteed exact-to-the-second alarm.

## 1. Create Firebase project
1. Create a Firebase project.
2. Add an Android app with package ID `com.poply.app`.
3. Add a Web app and copy its config into `src/firebase.js`.
4. Enable **Authentication → Email/Password**.
5. Create **Realtime Database** and choose a region.
6. Copy the database URL into `src/firebase.js`.
7. Publish `database.rules.json` in Realtime Database → Rules.
8. Download `google-services.json` for the Android app.

## 2. Configure GitHub
- Upload the ZIP contents to a new GitHub repository (the files inside Poply, not the outer folder).
- In repository Settings → Secrets and variables → Actions, add:
  - `GOOGLE_SERVICES_JSON`: the entire contents of `google-services.json`.
- Commit to `main` or run Actions → Build Poply Android APK → Run workflow.
- Download the `Poply-debug-apk` artifact from the completed workflow.

## 3. Deploy friend scheduling backend
Friend delivery requires Firebase Cloud Functions and Cloud Scheduler. Firebase may require the Blaze billing plan for scheduled functions.
From a computer or Termux with Firebase CLI:
```bash
npm install -g firebase-tools
firebase login
firebase use YOUR_PROJECT_ID
cd functions
npm install
cd ..
firebase deploy --only functions:deliverScheduledPopups
```
The function sends a visible push notification at the scheduled time and writes the pop-up into the recipient inbox. The recipient taps the notification to view it in Poply.

## 4. Build locally (optional)
```bash
npm install
npm run build
npx cap add android
npx cap sync android
```

## 5. Current prototype notes
- Gallery images are converted to PNG data URLs with a 900px maximum edge so transparent pixels remain transparent. This is suitable for small pop-up art, not large video/media storage.
- This starter uses a simple username lookup. Before a public release, add stronger server-side validation, rate limits, abuse reporting/blocking, and production-grade database rules.
- Do not publish Firebase service-account credentials or private server keys in the APK or GitHub repository.
