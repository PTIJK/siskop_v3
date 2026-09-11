import { initializeApp } from "firebase/app";
import {
  initializeAuth, inMemoryPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut
} from "firebase/auth";

// This module is loaded only by the lazy registration/login pages. Credentials
// live in memory for the exchange, then are cleared; SISKOP uses its httpOnly cookie.
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
}, "siskop-onboarding");
const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
auth.languageCode = "id";
const google = new GoogleAuthProvider();
google.setCustomParameters({ prompt: "select_account" });
export type AuthMethod = "password" | "google";

export async function identityToken(method: AuthMethod, email: string, password: string, register = false) {
  // Invoke the popup immediately from the submit click to preserve browser activation.
  const credential = method === "google"
    ? await signInWithPopup(auth, google)
    : await passwordCredential(email, password, register);
  return credential.user.getIdToken(true);
}
async function passwordCredential(email: string, password: string, register: boolean) {
  if (!register) return signInWithEmailAndPassword(auth, email, password);
  try {
    return await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    // A previous registration attempt may have created Firebase identity before
    // the workspace request failed. Resume only after proving the same password.
    if (code(error) !== "auth/email-already-in-use") throw error;
    return signInWithEmailAndPassword(auth, email, password);
  }
}
export async function clearFirebaseIdentity() { await signOut(auth); }
export async function resetPassword(email: string) { await sendPasswordResetEmail(auth, email); }
function code(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
}
export function firebaseError(error: unknown): string | null {
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Email atau kata sandi tidak cocok. Gunakan metode masuk saat mendaftar.",
    "auth/wrong-password": "Email atau kata sandi tidak cocok.",
    "auth/user-not-found": "Email atau kata sandi tidak cocok.",
    "auth/weak-password": "Kata sandi belum memenuhi persyaratan keamanan. Gunakan minimal 8 karakter.",
    "auth/password-does-not-meet-requirements": "Gunakan kata sandi yang lebih kuat dengan huruf besar, huruf kecil, angka, dan simbol.",
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan masuk untuk melanjutkan.",
    "auth/invalid-email": "Periksa kembali alamat email Anda.",
    "auth/popup-closed-by-user": "Jendela Google ditutup. Silakan coba lagi.",
    "auth/cancelled-popup-request": "Permintaan Google dibatalkan. Silakan coba lagi.",
    "auth/popup-blocked": "Izinkan pop-up untuk melanjutkan dengan Google.",
    "auth/account-exists-with-different-credential": "Email ini menggunakan metode masuk lain. Masuk dengan metode yang Anda gunakan saat mendaftar.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Silakan coba lagi nanti.",
    "auth/network-request-failed": "Koneksi terputus. Periksa internet Anda dan coba lagi.",
    "auth/user-disabled": "Akun tidak aktif. Hubungi pengelola.",
    "auth/unauthorized-domain": "Alamat situs ini belum diizinkan untuk Google. Hubungi pengelola."
  };
  return messages[code(error)] ?? (code(error).startsWith("auth/") ? "Belum dapat masuk. Silakan coba kembali." : null);
}
