import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ---------------------------------------------------------------------- */
/* Theme (persisted, shared with dashboard.html)                          */
/* ---------------------------------------------------------------------- */
(function initTheme() {
  const saved = localStorage.getItem("appTheme") || "dark";
  document.body.classList.toggle("light-mode", saved === "light");
  const btn = document.getElementById("theme-btn");
  if (btn) btn.textContent = saved === "light" ? "🌙" : "☀️";
  btn?.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-mode");
    localStorage.setItem("appTheme", isLight ? "light" : "dark");
    btn.textContent = isLight ? "🌙" : "☀️";
  });
})();

/* ---------------------------------------------------------------------- */
/* Toast + loading                                                        */
/* ---------------------------------------------------------------------- */
const showToast = (message, type = "info") => {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 220);
  }, 3200);
};

const toggleLoading = (show) => {
  document.getElementById("loading")?.classList.toggle("show", !!show);
};

/* ---------------------------------------------------------------------- */
/* Referal kodu — URL-dən tutulub localStorage-a artıq inline script       */
/* tərəfindən yazılıb (bax: index.html <head>). Bura yalnız log üçün.      */
/* ---------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  const refCode = new URLSearchParams(window.location.search).get("ref");
  if (refCode) console.log("Referal kod aktivdir:", refCode);
});

/* ---------------------------------------------------------------------- */
/* Login / Register tab UI                                                */
/* ---------------------------------------------------------------------- */
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const fullnameField = document.getElementById("fullname-field");
const mainBtn = document.getElementById("mainBtn");
const titleText = document.getElementById("titleText");
const loginOptions = document.getElementById("login-options");
const googleDivider = document.getElementById("google-divider");
const googleBtn = document.getElementById("googleBtn");
const switchLine = document.getElementById("switch-line");
const switchLink = document.getElementById("switchToRegister");

let mode = "login";

function setMode(next) {
  mode = next;
  const isLogin = mode === "login";

  tabLogin.classList.toggle("active", isLogin);
  tabRegister.classList.toggle("active", !isLogin);
  fullnameField.style.display = isLogin ? "none" : "block";
  document.getElementById("fullname").required = !isLogin;

  titleText.textContent = isLogin ? "Hesabınıza daxil olun" : "Yeni hesab yaradın";
  mainBtn.innerHTML = isLogin
    ? '<span class="ignition-dot"></span> Daxil ol'
    : '<span class="ignition-dot"></span> Qeydiyyatı tamamla';

  loginOptions.style.display = isLogin ? "flex" : "none";
  googleDivider.style.display = isLogin ? "flex" : "none";
  googleBtn.style.display = isLogin ? "flex" : "none";

  switchLine.innerHTML = isLogin
    ? 'Hesabın yoxdur? <span id="switchToRegister">Qeydiyyatdan keç</span>'
    : 'Hesabın var? <span id="switchToRegister">Daxil ol</span>';
  document.getElementById("switchToRegister").addEventListener("click", () => setMode(isLogin ? "register" : "login"));
}

tabLogin.addEventListener("click", () => setMode("login"));
tabRegister.addEventListener("click", () => setMode("register"));
switchLink.addEventListener("click", () => setMode("register"));

/* ---------------------------------------------------------------------- */
/* Referal zəncirinin oxunması (L1 → L2 → L3)                             */
/* ---------------------------------------------------------------------- */
async function resolveReferralChain(currentUid) {
  const referrerUid = localStorage.getItem("referredBy");
  const validReferrerUid = (referrerUid && referrerUid !== currentUid) ? referrerUid : null;

  let l2 = null, l3 = null;
  if (validReferrerUid) {
    try {
      const l1Doc = await getDoc(doc(db, "users", validReferrerUid));
      if (l1Doc.exists()) {
        l2 = l1Doc.data().referredBy || null;
        l3 = l1Doc.data().referredByL2 || null;
      } else {
        // Referral kodu köhnəlib/etibarsızdır — sakitcə ləğv edirik
        return { l1: null, l2: null, l3: null };
      }
    } catch (err) {
      console.error("Zəncirvari referal oxunmadı:", err);
    }
  }
  return { l1: validReferrerUid, l2, l3 };
}

async function createUserProfile(user, name) {
  const { l1, l2, l3 } = await resolveReferralChain(user.uid);

  await setDoc(doc(db, "users", user.uid), {
    name: name || user.displayName || "Yeni İstifadəçi",
    email: user.email,
    phone: "",
    wallet: "",
    balance: 0,
    vipLevel: "LV0",
    role: "user",
    profileImg: user.photoURL || "",
    isBanned: false,
    referredBy: l1,
    referredByL2: l2,
    referredByL3: l3,
    referralsCount: 0,
    referralEarnings: 0,
    lastCheckIn: 0,
    checkInStreak: 0,
    createdAt: Date.now()
  });

  if (l1) {
    try {
      await updateDoc(doc(db, "users", l1), { referralsCount: increment(1) });
    } catch (err) {
      console.error("Referal sayı artırılmadı:", err);
    }
  }
  localStorage.removeItem("referredBy");
}

/* ---------------------------------------------------------------------- */
/* Əsas forma (Giriş / Qeydiyyat)                                          */
/* ---------------------------------------------------------------------- */
const authForm = document.getElementById("auth-form");
authForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value.trim();
  const fullname = document.getElementById("fullname")?.value.trim();

  if (!email || !password) {
    showToast("Zəhmət olmasa bütün xanaları doldurun!", "error");
    return;
  }
  if (mode === "register" && !fullname) {
    showToast("Zəhmət olmasa Ad və Soyad daxil edin!", "error");
    return;
  }

  toggleLoading(true);
  mainBtn.disabled = true;

  try {
    if (mode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Giriş uğurludur! Yönləndirilirsiniz...", "success");
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await createUserProfile(cred.user, fullname);
      showToast("Qeydiyyat tamamlandı! Giriş edilir...", "success");
    }
  } catch (error) {
    console.error("Auth Xətası:", error);
    let msg = "Xəta baş verdi. Yenidən yoxlayın.";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(error.code)) {
      msg = "Email və ya şifrə yanlışdır!";
    } else if (error.code === "auth/email-already-in-use") {
      msg = "Bu email ünvanı artıq qeydiyyatdan keçib!";
    } else if (error.code === "auth/weak-password") {
      msg = "Şifrə çox zəifdir (ən az 6 simvol)!";
    } else if (error.code === "auth/invalid-email") {
      msg = "Email ünvanı düzgün deyil!";
    } else if (error.code === "auth/too-many-requests") {
      msg = "Çox sayda cəhd edildi. Bir az sonra yenidən yoxlayın.";
    }
    showToast(msg, "error");
  } finally {
    toggleLoading(false);
    mainBtn.disabled = false;
  }
});

/* ---------------------------------------------------------------------- */
/* Google ilə giriş                                                        */
/* ---------------------------------------------------------------------- */
googleBtn?.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  toggleLoading(true);
  googleBtn.disabled = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      await createUserProfile(user, user.displayName);
    }
    showToast("Google ilə giriş uğurludur!", "success");
  } catch (error) {
    console.error("Google Auth Xətası:", error);
    if (error.code !== "auth/popup-closed-by-user") {
      showToast("Google ilə giriş alınmadı.", "error");
    }
  } finally {
    toggleLoading(false);
    googleBtn.disabled = false;
  }
});

/* ---------------------------------------------------------------------- */
/* Şifrəni unutdum                                                         */
/* ---------------------------------------------------------------------- */
document.getElementById("forgotPassBtn")?.addEventListener("click", async () => {
  const email = document.getElementById("email")?.value.trim();
  if (!email) {
    showToast("Şifrəni sıfırlamaq üçün əvvəlcə emailinizi yazın!", "info");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Şifrə sıfırlama linki emailinizə göndərildi!", "success");
  } catch (error) {
    showToast("Email tapılmadı və ya xəta baş verdi.", "error");
  }
});

/* ---------------------------------------------------------------------- */
/* Aktiv sessiya yoxlanışı — hesabı olan istifadəçini dashboard-a yönləndir */
/* ---------------------------------------------------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      await createUserProfile(user, user.displayName);
    }
  } catch (err) {
    console.error("Profil yoxlanışı xətası:", err);
  }
  window.location.replace("dashboard.html");
});
