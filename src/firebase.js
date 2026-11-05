import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

// Replace these values with your Firebase project's Web App config.
// Firebase Console -> Project settings -> General -> Your apps -> Web app.
const firebaseConfig = {
  apiKey: "AIzaSyAi27biKcUGvCB4kXsXEdgeq85JLBb7a_Y",
  authDomain: "library-a60e3.firebaseapp.com",
  databaseURL: "https://library-a60e3-default-rtdb.firebaseio.com",
  projectId: "library-a60e3",
  storageBucket: "library-a60e3.firebasestorage.app",
  messagingSenderId: "933820691428",
  appId: "1:933820691428:web:25dcddcfc078ac910acdf1"
};

export const firebaseConfigured = !Object.values(firebaseConfig).some(v =>
  String(v).includes("PASTE_") || String(v).includes("YOUR_PROJECT_ID")
);
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
