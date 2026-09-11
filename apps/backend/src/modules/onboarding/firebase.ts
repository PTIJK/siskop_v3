import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { z } from "zod";
import { unauthorized } from "../../lib/errors.js";

function auth() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is required");
  // Emulator tokens are unsigned. Never accept them in a deployed runtime.
  if (process.env.NODE_ENV === "production" && process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error("Firebase Auth emulator is forbidden in production");
  const app = getApps().find((item) => item.name === "siskop-auth") ??
    initializeApp({ projectId }, "siskop-auth");
  return getAuth(app);
}

export async function verifyFirebaseIdentity(idToken: string) {
  try {
    const token = await auth().verifyIdToken(idToken, true);
    const provider = z.enum(["google.com", "password"]).parse(token.firebase.sign_in_provider);
    const email = z.string().email().max(254).parse(token.email).toLowerCase();
    // Registration/session exchange requires a deliberate recent sign-in.
    const age = Date.now() / 1000 - token.auth_time;
    if (age > 600 || age < -60) throw new Error("Recent sign-in required");
    return { uid: token.uid, email, provider, authTime: token.auth_time };
  } catch {
    throw unauthorized("Sesi masuk tidak valid atau kedaluwarsa. Silakan masuk kembali.");
  }
}

/** Preserve the original Firebase authentication time across app refreshes. */
export async function assertFirebaseSession(uid: string, authTime: number | undefined) {
  try {
    if (!authTime) throw new Error("Missing authentication time");
    const user = await auth().getUser(uid);
    if (user.disabled || (user.tokensValidAfterTime && authTime * 1000 < Date.parse(user.tokensValidAfterTime)))
      throw new Error("Revoked session");
  } catch {
    throw unauthorized("Sesi berakhir. Silakan masuk kembali.");
  }
}
