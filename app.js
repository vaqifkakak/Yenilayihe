import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, onSnapshot, collection, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, runTransaction, getDocs, getDoc, increment,
  serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ============================================================================
   0. SABİTLƏR
   ========================================================================== */

// VIP həddi: nə qədər çox investisiya, bir o qədər yüksək bonus faizi.
// (Qeyd: köhnə versiyada bu tərs sıralanmışdı — LV1 10% > LV2 5% > LV3 2% —
//  düzəldildi: indi yüksək səviyyə HƏMİŞƏ daha çox bonus verir.)
const VIP_TIERS = [
  { level: "LV0", label: "Standart", min: 0,    rate: 0    },
  { level: "LV1", label: "VIP 1",    min: 500,  rate: 0.08 },
  { level: "LV2", label: "VIP 2",    min: 2000, rate: 0.15 },
  { level: "LV3", label: "VIP 3",    min: 5000, rate: 0.25 },
];

const REFERRAL_RATES = { l1: 0.10, l2: 0.05, l3: 0.02 };
const CHECKIN_REWARD = 0.25;
const CHECKIN_WINDOW = 24 * 60 * 60 * 1000;
const CHECKIN_GRACE = 48 * 60 * 60 * 1000; // bu müddətdən sonra seriya sıfırlanır
const CLAIM_COOLDOWN = 24 * 60 * 60 * 1000;
const MIN_WITHDRAW = 10;

/* ============================================================================
   1. QLOBAL VƏZİYYƏT
   ========================================================================== */

let currentUserData = null;
let globalProducts = [];
let myCarsData = [];
let activeCategory = "all";
let searchQuery = "";
let isAdmin = false;
let adminUnsubs = [];
let countdownTimer = null;
let adminUsersCache = [];
let editingProductId = null;

/* ============================================================================
   2. KÖMƏKÇİ FUNKSİYALAR
   ========================================================================== */

const escapeHTML = (str) => {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>'"]/g, (tag) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[tag] || tag));
};

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const $ = (id) => document.getElementById(id);

const showToast = (message, type = "info") => {
  let container = document.getElementById("toast-container");
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

const toggleLoading = (show) => $("loading")?.classList.toggle("show", !!show);

function getVipInfo(totalInvested) {
  const inv = Number(totalInvested) || 0;
  let current = VIP_TIERS[0];
  let next = VIP_TIERS[1];
  for (let i = 0; i < VIP_TIERS.length; i++) {
    if (inv >= VIP_TIERS[i].min) {
      current = VIP_TIERS[i];
      next = VIP_TIERS[i + 1] || null;
    }
  }
  let progress = 100;
  if (next) {
    const span = next.min - current.min;
    progress = Math.min(100, Math.max(0, ((inv - current.min) / span) * 100));
  }
  return { ...current, next, progress, invested: inv };
}

function triggerConfetti() {
  const colors = ["#f2a93b", "#ffcb73", "#3fa872", "#f5f3ee"];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("div");
    c.style.cssText = `position:fixed;width:8px;height:8px;background:${colors[Math.floor(Math.random() * colors.length)]};left:${Math.random() * 100}vw;top:-10px;border-radius:2px;z-index:10050;pointer-events:none;transition:transform 1.1s ease-in,opacity 1.1s ease-out;`;
    document.body.appendChild(c);
    requestAnimationFrame(() => {
      c.style.transform = `translateY(100vh) rotate(${Math.random() * 360}deg)`;
      c.style.opacity = "0";
    });
    setTimeout(() => c.remove(), 1200);
  }
}

function animateNumber(el, oldVal, newVal, prefix = "$") {
  if (!el) return;
  const start = Number(oldVal) || 0;
  const end = Number(newVal) || 0;
  const duration = 700;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + (start + (end - start) * eased).toFixed(2);
    if (p < 1) requestAnimationFrame(step);
    else {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 400);
    }
  }
  requestAnimationFrame(step);
}

function timeLeftLabel(ms) {
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function closeModal(id) {
  $(id)?.classList.add("hidden");
}
function openModal(id) {
  $(id)?.classList.remove("hidden");
}
document.addEventListener("click", (e) => {
  const closeBtn = e.target.closest("[data-close]");
  if (closeBtn) closeModal(closeBtn.dataset.close);
  if (e.target.classList.contains("modal-overlay")) e.target.classList.add("hidden");
});

/* ============================================================================
   3. TEMA
   ========================================================================== */
(function initTheme() {
  const saved = localStorage.getItem("appTheme") || "dark";
  document.body.classList.toggle("light-mode", saved === "light");
  document.querySelectorAll("#theme-btn").forEach((btn) => {
    btn.textContent = saved === "light" ? "🌙" : "☀️";
    btn.addEventListener("click", () => {
      const isLight = document.body.classList.toggle("light-mode");
      localStorage.setItem("appTheme", isLight ? "light" : "dark");
      document.querySelectorAll("#theme-btn").forEach((b) => (b.textContent = isLight ? "🌙" : "☀️"));
    });
  });
})();

/* ============================================================================
   4. NAVİQASİYA
   ========================================================================== */
function switchView(target) {
  document.querySelectorAll(".page-view").forEach((v) => v.classList.toggle("active", v.id === target));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active-tab", n.dataset.target === target));
  if (target === "view-admin" && isAdmin) initAdminPanel();
  if (target === "view-tasks") loadLeaderboard();
  window.scrollTo({ top: 0, behavior: "instant" });
}
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.target));
});

/* ============================================================================
   5. AUTH GUARD
   ========================================================================== */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  const userRef = doc(db, "users", user.uid);
  onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.isBanned) {
      showToast("Hesabınız məhdudlaşdırılıb. Admin ilə əlaqə saxlayın.", "error");
      signOut(auth);
      return;
    }

    currentUserData = { uid: user.uid, ...data };
    isAdmin = data.role === "admin";
    $("nav-admin")?.classList.toggle("hidden", !isAdmin);

    renderProfile(user);
    renderHero();
    renderCheckIn();
  }, (err) => {
    console.error("İstifadəçi məlumatı oxunmadı:", err);
  });

  listenProducts();
  listenMyCars(user.uid);
});

function logout() {
  signOut(auth).catch((e) => console.error(e));
}
$("logout-btn")?.addEventListener("click", logout);
$("logout-btn-2")?.addEventListener("click", logout);

/* ============================================================================
   6. PROFİL VƏ HERO (İNVESTOR PANELİ)
   ========================================================================== */
function renderProfile(user) {
  const d = currentUserData;
  if ($("profile-name")) $("profile-name").textContent = d.name || "İstifadəçi";
  if ($("profile-email")) $("profile-email").textContent = d.email || user.email || "";
  if ($("profile-img")) $("profile-img").src = d.profileImg || user.photoURL || "";
  if ($("uid-display")) $("uid-display").textContent = `UID: ${user.uid}`;

  const vip = getVipInfo(d.totalInvested || 0);
  if ($("profile-vip")) $("profile-vip").textContent = vip.level === "LV0" ? "Standart Hesab" : `${vip.label} İnvestor`;
}

let __prevHeroTotal = null;
function renderHero() {
  const d = currentUserData;
  const balance = Number(d.balance) || 0;
  const invested = Number(d.totalInvested) || 0;
  const total = balance + invested;
  const vip = getVipInfo(invested);

  let dailyIncome = 0;
  myCarsData.forEach((car) => {
    const base = Number(car.dailyIncome || car.baseIncome || car.income || 0);
    dailyIncome += base + base * vip.rate;
  });
  const yearlyIncome = dailyIncome * 365;
  const roi = invested > 0 ? (yearlyIncome / invested) * 100 : 0;

  if ($("hero-total")) {
    if (__prevHeroTotal === null) $("hero-total").textContent = fmt(total);
    else if (__prevHeroTotal !== total) animateNumber($("hero-total"), __prevHeroTotal, total, "$");
    __prevHeroTotal = total;
  }
  if ($("stat-balance")) $("stat-balance").textContent = fmt(balance);
  if ($("stat-invested")) $("stat-invested").textContent = fmt(invested);
  if ($("stat-daily")) $("stat-daily").textContent = fmt(dailyIncome);
  if ($("stat-roi")) $("stat-roi").textContent = `${roi.toFixed(0)}%`;
  if ($("vip-badge-hero")) $("vip-badge-hero").textContent = vip.level;

  // Gauge (növbəti VIP səviyyəsinə qədər irəliləyiş)
  const circle = $("vip-gauge-circle");
  const CIRC = 264; // 2*pi*42
  if (circle) {
    const offset = CIRC - (vip.progress / 100) * CIRC;
    circle.setAttribute("stroke-dashoffset", offset.toFixed(1));
  }
  if ($("gauge-percent")) $("gauge-percent").textContent = `${vip.progress.toFixed(0)}%`;
  if ($("vip-next-title")) {
    $("vip-next-title").textContent = vip.next
      ? `${vip.next.label}-ə qədər ${fmt(Math.max(0, vip.next.min - vip.invested))}`
      : "Maksimum VIP səviyyəsindəsiniz";
  }
  if ($("vip-next-sub")) {
    $("vip-next-sub").textContent = vip.next
      ? `${vip.next.label} səviyyəsində gündəlik gəliriniz +${(vip.next.rate * 100).toFixed(0)}% artacaq.`
      : `Hazırkı bonusunuz: gündəlik gəlirə +${(vip.rate * 100).toFixed(0)}%.`;
  }
}

/* ============================================================================
   7. GÜNDƏLİK BONUS (CHECK-IN)
   ========================================================================== */
function renderCheckIn() {
  const d = currentUserData;
  const last = Number(d.lastCheckIn) || 0;
  const now = Date.now();
  const elapsed = now - last;
  const btn = $("checkin-btn");
  const streakEl = $("checkin-streak-val");
  const subEl = $("checkin-sub-text");
  if (streakEl) streakEl.textContent = d.checkInStreak || 0;

  if (!btn) return;
  if (elapsed >= CHECKIN_WINDOW) {
    btn.disabled = false;
    btn.textContent = `🎁 Bugünkü Bonusu Al (${fmt(CHECKIN_REWARD)})`;
    if (subEl) subEl.textContent = "Hər gün daxil olub bonus qazanın";
  } else {
    btn.disabled = true;
    const left = CHECKIN_WINDOW - elapsed;
    btn.textContent = `✓ Bugün alınıb — ${timeLeftLabel(left)}`;
    if (subEl) subEl.textContent = "Növbəti bonus üçün geri sayım aparılır";
    clearTimeout(window.__checkinTick);
    window.__checkinTick = setTimeout(renderCheckIn, 1000);
  }
}

$("checkin-btn")?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  const btn = $("checkin-btn");
  btn.disabled = true;
  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    await runTransaction(db, async (t) => {
      const snap = await t.get(userRef);
      const data = snap.data();
      const last = Number(data.lastCheckIn) || 0;
      const now = Date.now();
      if (now - last < CHECKIN_WINDOW) throw new Error("Bugünkü bonus artıq alınıb!");
      const newStreak = (now - last <= CHECKIN_GRACE && last > 0) ? (Number(data.checkInStreak) || 0) + 1 : 1;
      t.update(userRef, {
        balance: increment(CHECKIN_REWARD),
        lastCheckIn: now,
        checkInStreak: newStreak
      });
    });
    showToast(`+${fmt(CHECKIN_REWARD)} bonus qazandınız! 🔥`, "success");
    triggerConfetti();
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================================
   8. MƏHSULLAR (MAŞIN BAZARI)
   ========================================================================== */
function listenProducts() {
  onSnapshot(collection(db, "products"), (snap) => {
    globalProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProducts();
    if (isAdmin) renderAdminProducts();
  }, (err) => console.error("Məhsullar oxunmadı:", err));
}

function renderProducts() {
  const list = $("product-list");
  if (!list) return;

  const filtered = globalProducts.filter((p) => {
    const matchesCat = activeCategory === "all" || p.category === activeCategory;
    const matchesSearch = !searchQuery || (p.name || "").toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state card"><div class="empty-icon">🔍</div><div class="empty-title">Nəticə tapılmadı</div><div class="empty-sub">Axtarış və ya filtri dəyişməyi sınayın.</div></div>`;
    return;
  }

  const myCarIds = new Set(myCarsData.map((c) => c.id));

  list.innerHTML = filtered.map((p) => {
    const owned = myCarIds.has(p.id);
    const baseIncome = Number(p.dailyIncome || p.income || 0);
    return `
    <div class="card product-card">
      <div class="product-thumb">${productThumb(p)}</div>
      <div class="product-body">
        <h3>${escapeHTML(p.name || "Naməlum Model")}</h3>
        <div class="product-specs">${escapeHTML(p.hp || "?")} HP · ${escapeHTML(p.engine || "?")} · ${escapeHTML(p.speed || "?")}</div>
        <div class="product-row">
          <div>
            <div class="product-price">${fmt(p.price)}</div>
            <div class="product-income">+${fmt(baseIncome)}/gün</div>
          </div>
          <button class="buy-btn" data-buy="${p.id}" ${owned ? "disabled" : ""}>${owned ? "✓ Sizdə var" : "Al"}</button>
        </div>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyCar(btn.dataset.buy, btn));
  });
}

function productThumb(p) {
  if (!p.image) return carThumbSVG(p.category);
  // Şəkil varsa göstər; yüklənmirsə (broken link) avtomatik SVG ikonuna keç.
  return `<img src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name || "")}"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
          <div style="display:none; width:100%; height:100%;">${carThumbSVG(p.category)}</div>`;
}

function carThumbSVG(category) {
  const colors = { sport: "#e5675f", suv: "#5b9bf2", classic: "#f2a93b" };
  const c = colors[category] || "#9a9fae";
  return `<svg viewBox="0 0 84 84" xmlns="http://www.w3.org/2000/svg">
    <rect width="84" height="84" fill="${c}" opacity="0.14"/>
    <path d="M18 50 L24 36 Q27 31 34 31 L50 31 Q57 31 60 36 L66 50" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="14" y="49" width="56" height="12" rx="4" fill="${c}"/>
    <circle cx="27" cy="61" r="7" fill="#12141A" stroke="${c}" stroke-width="3"/>
    <circle cx="57" cy="61" r="7" fill="#12141A" stroke="${c}" stroke-width="3"/>
  </svg>`;
}

$("search-input")?.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderProducts();
});
document.querySelectorAll("#category-filters button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#category-filters button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.cat;
    renderProducts();
  });
});

async function buyCar(productId, btnEl) {
  if (!auth.currentUser) return;
  if (btnEl) { btnEl.textContent = "⏳..."; btnEl.disabled = true; }

  try {
    const product = globalProducts.find((p) => p.id === productId);
    if (!product) throw new Error("Maşın tapılmadı.");

    const userRef = doc(db, "users", auth.currentUser.uid);
    const carRef = doc(db, "users", auth.currentUser.uid, "cars", productId);

    await runTransaction(db, async (t) => {
      const carDoc = await t.get(carRef);
      if (carDoc.exists()) throw new Error("Bu maşın artıq qarajınızdadır!");

      const userDoc = await t.get(userRef);
      if (!userDoc.exists()) throw new Error("İstifadəçi tapılmadı!");
      const balance = Number(userDoc.data().balance) || 0;
      if (balance < product.price) throw new Error("Balansınız kifayət etmir!");

      t.update(userRef, {
        balance: increment(-product.price),
        totalInvested: increment(product.price)
      });
      t.set(carRef, {
        ...product,
        purchasedAt: Date.now(),
        lastClaim: Date.now()
      });
    });

    showToast("Təbriklər! Maşın qarajınıza əlavə olundu. 🚗", "success");
    triggerConfetti();
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
  } finally {
    if (btnEl) { btnEl.disabled = false; }
  }
}

/* ============================================================================
   9. MƏNİM MAŞINLARIM VƏ GƏLİR TOPLAMA
   ========================================================================== */
function listenMyCars(uid) {
  onSnapshot(collection(db, "users", uid, "cars"), (snap) => {
    myCarsData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMyCars();
    renderProducts();
    if (currentUserData) renderHero();
  }, (err) => console.error("Maşınlar oxunmadı:", err));
}

function renderMyCars() {
  const list = $("my-cars-list");
  if (!list) return;

  if (myCarsData.length === 0) {
    list.innerHTML = `<div class="empty-state card"><div class="empty-icon">🅿️</div><div class="empty-title">Qarajınız boşdur</div><div class="empty-sub">Ev səhifəsindən maşın alaraq gəlir qazanmağa başlayın.</div></div>`;
    return;
  }

  const vip = getVipInfo(currentUserData?.totalInvested || 0);

  list.innerHTML = myCarsData.map((car) => {
    const baseIncome = Number(car.dailyIncome || car.baseIncome || car.income || 0);
    const actualIncome = baseIncome + baseIncome * vip.rate;
    const lastClaim = Number(car.lastClaim) || 0;
    const left = CLAIM_COOLDOWN - (Date.now() - lastClaim);
    const ready = left <= 0;
    return `
    <div class="card product-card">
      <div class="product-thumb">${productThumb(car)}</div>
      <div class="product-body">
        <h3>${escapeHTML(car.name || "Maşın")}</h3>
        <div class="product-specs">Alış qiyməti: ${fmt(car.price)}</div>
        <div class="product-row">
          <div>
            <div class="product-income">+${fmt(actualIncome)}/gün</div>
            <span class="timer-chip ${ready ? "ready" : ""}" data-countdown="${car.id}" data-lastclaim="${lastClaim}">
              ${ready ? "Toplamaq üçün hazırdır!" : timeLeftLabel(left)}
            </span>
          </div>
          <button class="buy-btn" data-claim="${car.id}" ${ready ? "" : "disabled"}>${ready ? "Topla" : "Gözlə"}</button>
        </div>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-claim]").forEach((btn) => {
    btn.addEventListener("click", () => collectIncome(btn.dataset.claim, btn));
  });

  startCountdownTicker();
}

function startCountdownTicker() {
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    document.querySelectorAll("[data-countdown]").forEach((chip) => {
      const lastClaim = Number(chip.dataset.lastclaim) || 0;
      const left = CLAIM_COOLDOWN - (Date.now() - lastClaim);
      const btn = chip.closest(".product-body")?.querySelector("[data-claim]");
      if (left <= 0) {
        chip.textContent = "Toplamaq üçün hazırdır!";
        chip.classList.add("ready");
        if (btn) { btn.disabled = false; btn.textContent = "Topla"; }
      } else {
        chip.textContent = timeLeftLabel(left);
      }
    });
  }, 1000);
}

async function collectIncome(carId, btnEl) {
  if (!auth.currentUser) return;
  if (btnEl) { btnEl.textContent = "⏳"; btnEl.disabled = true; }

  try {
    const uid = auth.currentUser.uid;
    const carRef = doc(db, "users", uid, "cars", carId);
    const userRef = doc(db, "users", uid);

    let earned = 0;

    await runTransaction(db, async (t) => {
      // ---- OXUMALAR (bütün yazılardan əvvəl) ----
      const carDoc = await t.get(carRef);
      if (!carDoc.exists()) throw new Error("Maşın tapılmadı.");
      const carData = carDoc.data();
      const lastClaim = Number(carData.lastClaim) || 0;
      const now = Date.now();
      if (now - lastClaim < CLAIM_COOLDOWN) throw new Error("Hələ 24 saat tamamlanmayıb!");

      const userDoc = await t.get(userRef);
      if (!userDoc.exists()) throw new Error("İstifadəçi tapılmadı!");
      const userData = userDoc.data();

      const vip = getVipInfo(userData.totalInvested || 0);
      const baseIncome = Number(carData.dailyIncome || carData.baseIncome || carData.income || 0);
      const actualIncome = round2(baseIncome + baseIncome * vip.rate);
      earned = actualIncome;

      const l1Uid = userData.referredBy || null;
      const l2Uid = userData.referredByL2 || null;
      const l3Uid = userData.referredByL3 || null;

      let l1Ref = null, l1Doc = null;
      let l2Ref = null, l2Doc = null;
      let l3Ref = null, l3Doc = null;
      if (l1Uid) { l1Ref = doc(db, "users", l1Uid); l1Doc = await t.get(l1Ref); }
      if (l2Uid) { l2Ref = doc(db, "users", l2Uid); l2Doc = await t.get(l2Ref); }
      if (l3Uid) { l3Ref = doc(db, "users", l3Uid); l3Doc = await t.get(l3Ref); }

      // ---- YAZILAR ----
      t.update(carRef, { lastClaim: now });
      t.update(userRef, { balance: increment(actualIncome) });

      if (l1Doc && l1Doc.exists()) {
        const amt = round2(actualIncome * REFERRAL_RATES.l1);
        if (amt > 0) t.update(l1Ref, { balance: increment(amt), referralEarnings: increment(amt) });
      }
      if (l2Doc && l2Doc.exists()) {
        const amt = round2(actualIncome * REFERRAL_RATES.l2);
        if (amt > 0) t.update(l2Ref, { balance: increment(amt), referralEarnings: increment(amt) });
      }
      if (l3Doc && l3Doc.exists()) {
        const amt = round2(actualIncome * REFERRAL_RATES.l3);
        if (amt > 0) t.update(l3Ref, { balance: increment(amt), referralEarnings: increment(amt) });
      }
    });

    showToast(`+${fmt(earned)} gəlir toplandı! 💰`, "success");
    triggerConfetti();
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

/* ============================================================================
   10. LİDERLƏR LÖVHƏSİ
   ========================================================================== */
let leaderboardLoaded = false;
async function loadLeaderboard() {
  if (leaderboardLoaded) return;
  leaderboardLoaded = true;
  const list = $("leaderboard-list");
  try {
    const q = query(collection(db, "users"), orderBy("balance", "desc"), limit(10));
    const snap = await getDocs(q);
    if (snap.empty) {
      list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:16px 0;">Hələ məlumat yoxdur.</p>`;
      return;
    }
    const medals = ["🥇", "🥈", "🥉"];
    list.innerHTML = snap.docs.map((d, i) => {
      const u = d.data();
      return `<div class="leader-row">
        <div class="leader-rank ${i === 0 ? "top1" : ""}">${medals[i] || i + 1}</div>
        <div class="leader-name">${escapeHTML(u.name || "İstifadəçi")}</div>
        <div class="leader-val">${fmt(u.balance)}</div>
      </div>`;
    }).join("");
  } catch (err) {
    console.error("Liderlər lövhəsi oxunmadı:", err);
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:16px 0;">Yüklənə bilmədi.</p>`;
  }
}

/* ============================================================================
   11. DEPOZİT
   ========================================================================== */
$("deposit-btn")?.addEventListener("click", () => openModal("deposit-modal"));

function copyToClipboard(text, label) {
  navigator.clipboard?.writeText(text).then(
    () => showToast(`${label} kopyalandı!`, "success"),
    () => showToast("Kopyalanmadı, əl ilə seçin.", "error")
  );
}
$("copy-trc20")?.addEventListener("click", () => copyToClipboard($("trc20-address").value, "TRC20 ünvanı"));
$("copy-bep20")?.addEventListener("click", () => copyToClipboard($("bep20-address").value, "BEP20 ünvanı"));

$("deposit-send")?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  const amount = Number($("deposit-amount")?.value);
  const txid = $("txid")?.value.trim();
  if (!amount || amount <= 0) { showToast("Düzgün məbləğ daxil edin!", "error"); return; }
  if (!txid) { showToast("TXID daxil edin!", "error"); return; }

  const btn = $("deposit-send");
  btn.disabled = true; btn.textContent = "Göndərilir...";
  try {
    await addDoc(collection(db, "depositRequests"), {
      uid: auth.currentUser.uid,
      userName: currentUserData?.name || "",
      amount,
      txid,
      status: "pending",
      createdAt: Date.now()
    });
    showToast("Depozit sorğunuz göndərildi. Admin təsdiqini gözləyin.", "success");
    closeModal("deposit-modal");
    $("txid").value = "";
  } catch (err) {
    showToast("Xəta baş verdi, yenidən cəhd edin.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Sorğunu Göndər";
  }
});

/* ============================================================================
   12. NAĞDLAŞDIRMA (WITHDRAW)
   ========================================================================== */
$("withdraw-btn")?.addEventListener("click", () => openModal("withdraw-modal"));

$("withdraw-send")?.addEventListener("click", async () => {
  if (!auth.currentUser) return;
  const amount = Number($("withdraw-amount")?.value);
  const address = $("withdraw-address")?.value.trim();
  const network = $("withdraw-network")?.value;

  if (!amount || amount < MIN_WITHDRAW) { showToast(`Minimum nağdlaşdırma məbləği ${fmt(MIN_WITHDRAW)}-dır!`, "error"); return; }
  if (!address) { showToast("Cüzdan ünvanını daxil edin!", "error"); return; }
  if (amount > (currentUserData?.balance || 0)) { showToast("Balansınız kifayət etmir!", "error"); return; }

  const btn = $("withdraw-send");
  btn.disabled = true; btn.textContent = "Göndərilir...";
  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    const reqRef = doc(collection(db, "withdrawRequests"));
    await runTransaction(db, async (t) => {
      const userDoc = await t.get(userRef);
      const balance = Number(userDoc.data().balance) || 0;
      if (balance < amount) throw new Error("Balansınız kifayət etmir!");
      t.update(userRef, { balance: increment(-amount) });
      t.set(reqRef, {
        uid: auth.currentUser.uid,
        userName: currentUserData?.name || "",
        amount, address, network,
        status: "pending",
        createdAt: Date.now()
      });
    });
    showToast("Nağdlaşdırma sorğunuz göndərildi.", "success");
    closeModal("withdraw-modal");
    $("withdraw-amount").value = "";
    $("withdraw-address").value = "";
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Sorğunu Göndər";
  }
});

/* ============================================================================
   13. ƏMƏLİYYAT TARİXÇƏSİ
   ========================================================================== */
$("history-btn")?.addEventListener("click", async () => {
  openModal("history-modal");
  const list = $("history-list");
  list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px 0;">Yüklənir...</p>`;
  try {
    const uid = auth.currentUser.uid;
    const [depSnap, wSnap] = await Promise.all([
      getDocs(query(collection(db, "depositRequests"), where("uid", "==", uid))),
      getDocs(query(collection(db, "withdrawRequests"), where("uid", "==", uid)))
    ]);
    const items = [
      ...depSnap.docs.map((d) => ({ type: "deposit", ...d.data() })),
      ...wSnap.docs.map((d) => ({ type: "withdraw", ...d.data() }))
    ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (items.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-title">Tarixçə boşdur</div><div class="empty-sub">Hələ heç bir əməliyyat etməmisiniz.</div></div>`;
      return;
    }

    const statusBadge = (s) => {
      if (s === "approved" || s === "completed") return `<span class="badge badge-green">Təsdiqləndi</span>`;
      if (s === "rejected") return `<span class="badge badge-red">Rədd edildi</span>`;
      return `<span class="badge badge-amber">Gözləyir</span>`;
    };

    list.innerHTML = items.map((it) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 2px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700;font-size:13.5px;">${it.type === "deposit" ? "💰 Depozit" : "💸 Nağdlaşdırma"}</div>
          <div style="font-size:11px;color:var(--text-muted);">${new Date(it.createdAt || 0).toLocaleString("az-AZ")}</div>
        </div>
        <div style="text-align:right;">
          <div class="mono" style="font-weight:700;">${fmt(it.amount)}</div>
          ${statusBadge(it.status)}
        </div>
      </div>`).join("");
  } catch (err) {
    console.error(err);
    list.innerHTML = `<p style="text-align:center;color:var(--negative);padding:20px 0;">Tarixçə yüklənmədi.</p>`;
  }
});

/* ============================================================================
   14. REFERAL PANELİ
   ========================================================================== */
function dynamicModal(id, titleHTML, bodyHTML) {
  document.getElementById(id)?.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = id;
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <div class="modal-head"><h2>${titleHTML}</h2><button class="icon-btn" data-close="${id}">✕</button></div>
      ${bodyHTML}
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

$("referral-btn")?.addEventListener("click", async () => {
  const uid = auth.currentUser.uid;
  const refLink = new URL(`index.html?ref=${uid}`, window.location.href).href;

  const overlay = dynamicModal("referral-modal", "👥 Referal Komandam", `
    <div class="field">
      <label>Sizin Dəvət Linkiniz</label>
      <div class="deposit-address-row">
        <input class="input mono" id="ref-link-input" type="text" value="${escapeHTML(refLink)}" readonly style="font-size:11.5px;">
        <button class="btn btn-ghost btn-sm" id="ref-copy-btn">Kopyala</button>
      </div>
    </div>
    <div class="admin-stats" style="margin:16px 0;">
      <div class="card admin-stat"><div class="lbl">1-ci səviyyə (10%)</div><div class="val" id="ref-l1-count">–</div></div>
      <div class="card admin-stat"><div class="lbl">2-ci səviyyə (5%)</div><div class="val" id="ref-l2-count">–</div></div>
      <div class="card admin-stat"><div class="lbl">3-cü səviyyə (2%)</div><div class="val" id="ref-l3-count">–</div></div>
      <div class="card admin-stat"><div class="lbl">Ümumi qazanc</div><div class="val" id="ref-earnings">–</div></div>
    </div>
    <hr class="hairline">
    <div style="font-weight:800;font-size:13.5px;margin-bottom:8px;">Birbaşa Dəvət Etdikləriniz</div>
    <div id="ref-l1-list"><p style="text-align:center;color:var(--text-muted);padding:12px 0;">Yüklənir...</p></div>
  `);

  overlay.querySelector("#ref-copy-btn").addEventListener("click", () => copyToClipboard(refLink, "Referal linki"));

  try {
    const [l1Snap, l2Snap, l3Snap] = await Promise.all([
      getDocs(query(collection(db, "users"), where("referredBy", "==", uid))),
      getDocs(query(collection(db, "users"), where("referredByL2", "==", uid))),
      getDocs(query(collection(db, "users"), where("referredByL3", "==", uid)))
    ]);
    overlay.querySelector("#ref-l1-count").textContent = l1Snap.size;
    overlay.querySelector("#ref-l2-count").textContent = l2Snap.size;
    overlay.querySelector("#ref-l3-count").textContent = l3Snap.size;
    overlay.querySelector("#ref-earnings").textContent = fmt(currentUserData?.referralEarnings || 0);

    const listEl = overlay.querySelector("#ref-l1-list");
    if (l1Snap.empty) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🔗</div><div class="empty-title">Hələ dəvət etmisiniz yoxdur</div><div class="empty-sub">Linki paylaşaraq komandanızı qurun.</div></div>`;
    } else {
      listEl.innerHTML = l1Snap.docs.map((d) => {
        const u = d.data();
        return `<div class="leader-row"><div style="width:30px;">👤</div><div class="leader-name">${escapeHTML(u.name || "İstifadəçi")}</div><div style="font-size:11px;color:var(--text-muted);">${new Date(u.createdAt || 0).toLocaleDateString("az-AZ")}</div></div>`;
      }).join("");
    }
  } catch (err) {
    console.error("Referal siyahısı oxunmadı:", err);
    overlay.querySelector("#ref-l1-list").innerHTML = `<p style="text-align:center;color:var(--negative);padding:12px 0;">Yüklənmədi (icazə xətası ola bilər).</p>`;
  }
});

/* ============================================================================
   15. PROFİL VƏ ŞİFRƏ AYARLARI
   ========================================================================== */
$("password-btn")?.addEventListener("click", () => {
  const d = currentUserData;
  const overlay = dynamicModal("settings-modal", "🔐 Profil və Şifrə", `
    <div style="font-weight:800;font-size:13px;margin-bottom:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Profil Məlumatları</div>
    <div class="field"><label>Ad Soyad</label><input class="input" id="set-name" value="${escapeHTML(d.name || "")}"></div>
    <div class="field"><label>Telefon</label><input class="input" id="set-phone" value="${escapeHTML(d.phone || "")}" placeholder="+994 XX XXX XX XX"></div>
    <div class="field"><label>USDT Cüzdan Ünvanı</label><input class="input" id="set-wallet" value="${escapeHTML(d.wallet || "")}" placeholder="T... və ya 0x..."></div>
    <button class="btn btn-primary btn-block" id="save-profile-btn">Məlumatları Yadda Saxla</button>

    <hr class="hairline">
    <div style="font-weight:800;font-size:13px;margin-bottom:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;">Şifrəni Dəyiş</div>
    <div class="field"><label>Cari Şifrə</label><input class="input" type="password" id="set-current-pass"></div>
    <div class="field"><label>Yeni Şifrə</label><input class="input" type="password" id="set-new-pass" placeholder="Ən az 6 simvol"></div>
    <button class="btn btn-ghost btn-block" id="save-pass-btn">Şifrəni Yenilə</button>
  `);

  overlay.querySelector("#save-profile-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = "Yadda saxlanılır...";
    try {
      await updateDoc(doc(db, "users", auth.currentUser.uid), {
        name: overlay.querySelector("#set-name").value.trim(),
        phone: overlay.querySelector("#set-phone").value.trim(),
        wallet: overlay.querySelector("#set-wallet").value.trim()
      });
      showToast("Profil məlumatları yeniləndi!", "success");
    } catch (err) {
      showToast("Xəta baş verdi.", "error");
    } finally {
      btn.disabled = false; btn.textContent = "Məlumatları Yadda Saxla";
    }
  });

  overlay.querySelector("#save-pass-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    const currentPass = overlay.querySelector("#set-current-pass").value;
    const newPass = overlay.querySelector("#set-new-pass").value;
    if (!currentPass || !newPass) { showToast("Hər iki xananı doldurun!", "error"); return; }
    if (newPass.length < 6) { showToast("Yeni şifrə ən az 6 simvol olmalıdır!", "error"); return; }

    btn.disabled = true; btn.textContent = "Yenilənir...";
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPass);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPass);
      showToast("Şifrəniz uğurla yeniləndi!", "success");
      overlay.querySelector("#set-current-pass").value = "";
      overlay.querySelector("#set-new-pass").value = "";
    } catch (err) {
      showToast(err.code === "auth/wrong-password" ? "Cari şifrə yanlışdır!" : "Xəta baş verdi.", "error");
    } finally {
      btn.disabled = false; btn.textContent = "Şifrəni Yenilə";
    }
  });
});

/* ============================================================================
   16. ADMİN PANELİ
   ========================================================================== */
let adminInitialized = false;

document.querySelectorAll("#admin-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.panel));
  });
});

function initAdminPanel() {
  loadAdminStats();
  if (adminInitialized) return;
  adminInitialized = true;

  // ---- Depozitlər (canlı) ----
  const depQ = query(collection(db, "depositRequests"), where("status", "==", "pending"), orderBy("createdAt", "desc"));
  adminUnsubs.push(onSnapshot(depQ, (snap) => renderAdminDeposits(snap.docs), (err) => {
    console.error("Admin depozit oxunmadı:", err);
    $("admin-deposits-list").innerHTML = `<p style="text-align:center;color:var(--negative);">Yüklənmədi. Firestore index tələb oluna bilər (konsolda link çıxacaq).</p>`;
  }));

  // ---- Nağdlaşdırmalar (canlı) ----
  const wQ = query(collection(db, "withdrawRequests"), where("status", "==", "pending"), orderBy("createdAt", "desc"));
  adminUnsubs.push(onSnapshot(wQ, (snap) => renderAdminWithdrawals(snap.docs), (err) => {
    console.error("Admin nağdlaşdırma oxunmadı:", err);
    $("admin-withdrawals-list").innerHTML = `<p style="text-align:center;color:var(--negative);">Yüklənmədi. Firestore index tələb oluna bilər (konsolda link çıxacaq).</p>`;
  }));

  // ---- İstifadəçilər (bir dəfə yüklə, klient tərəfdə axtar) ----
  loadAdminUsers();
  $("admin-user-search")?.addEventListener("input", (e) => renderAdminUsers(e.target.value));

  renderAdminProducts();
}

async function loadAdminStats() {
  try {
    const usersCount = await getCountFromServer(collection(db, "users"));
    const productsCount = await getCountFromServer(collection(db, "products"));
    const pendingDep = await getCountFromServer(query(collection(db, "depositRequests"), where("status", "==", "pending")));
    const pendingW = await getCountFromServer(query(collection(db, "withdrawRequests"), where("status", "==", "pending")));

    $("admin-stat-users").textContent = usersCount.data().count;
    $("admin-stat-products").textContent = productsCount.data().count;
    $("admin-stat-pending").textContent = pendingDep.data().count + pendingW.data().count;

    // Ümumi balans — kiçik/orta istifadəçi bazası üçün uyğundur (tam siyahını oxuyur)
    const usersSnap = await getDocs(collection(db, "users"));
    let total = 0;
    usersSnap.forEach((d) => { total += Number(d.data().balance) || 0; });
    $("admin-stat-balance").textContent = fmt(total);
  } catch (err) {
    console.error("Admin statistikası oxunmadı:", err);
  }
}

/* ---- Depozitlər ---- */
function renderAdminDeposits(docs) {
  const list = $("admin-deposits-list");
  if (!list) return;
  if (docs.length === 0) {
    list.innerHTML = `<div class="empty-state card"><div class="empty-icon">✅</div><div class="empty-title">Gözləyən depozit yoxdur</div></div>`;
    return;
  }
  list.innerHTML = docs.map((d) => {
    const r = d.data();
    return `<div class="card admin-row">
      <div class="admin-row-top">
        <div>
          <div style="font-weight:800;">${escapeHTML(r.userName || r.uid)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${new Date(r.createdAt || 0).toLocaleString("az-AZ")}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">TXID: <span class="mono">${escapeHTML(r.txid || "-")}</span></div>
        </div>
        <div class="mono" style="font-weight:800;font-size:16px;">${fmt(r.amount)}</div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-success btn-sm" data-dep-approve="${d.id}">✓ Təsdiqlə</button>
        <button class="btn btn-danger btn-sm" data-dep-reject="${d.id}">✕ Rədd et</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-dep-approve]").forEach((b) => b.addEventListener("click", () => handleDeposit(b.dataset.depApprove, "approve", b)));
  list.querySelectorAll("[data-dep-reject]").forEach((b) => b.addEventListener("click", () => handleDeposit(b.dataset.depReject, "reject", b)));
}

async function handleDeposit(reqId, action, btnEl) {
  const row = btnEl.closest(".admin-row");
  row.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const reqRef = doc(db, "depositRequests", reqId);
    await runTransaction(db, async (t) => {
      const reqDoc = await t.get(reqRef);
      if (!reqDoc.exists()) throw new Error("Sorğu tapılmadı.");
      const reqData = reqDoc.data();
      if (reqData.status !== "pending") throw new Error("Bu sorğu artıq icra olunub.");

      if (action === "approve") {
        const userRef = doc(db, "users", reqData.uid);
        t.update(userRef, { balance: increment(Number(reqData.amount) || 0) });
        t.update(reqRef, { status: "approved", processedAt: Date.now() });
      } else {
        t.update(reqRef, { status: "rejected", processedAt: Date.now() });
      }
    });
    showToast(action === "approve" ? "Depozit təsdiqləndi!" : "Depozit rədd edildi.", "success");
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
    row.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

/* ---- Nağdlaşdırmalar ---- */
function renderAdminWithdrawals(docs) {
  const list = $("admin-withdrawals-list");
  if (!list) return;
  if (docs.length === 0) {
    list.innerHTML = `<div class="empty-state card"><div class="empty-icon">✅</div><div class="empty-title">Gözləyən nağdlaşdırma yoxdur</div></div>`;
    return;
  }
  list.innerHTML = docs.map((d) => {
    const r = d.data();
    return `<div class="card admin-row">
      <div class="admin-row-top">
        <div>
          <div style="font-weight:800;">${escapeHTML(r.userName || r.uid)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${new Date(r.createdAt || 0).toLocaleString("az-AZ")} · ${escapeHTML(r.network || "")}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;word-break:break-all;">${escapeHTML(r.address || "-")}</div>
        </div>
        <div class="mono" style="font-weight:800;font-size:16px;">${fmt(r.amount)}</div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-success btn-sm" data-w-approve="${d.id}">✓ Ödəndi</button>
        <button class="btn btn-danger btn-sm" data-w-reject="${d.id}">✕ Rədd et (Geri qaytar)</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-w-approve]").forEach((b) => b.addEventListener("click", () => handleWithdraw(b.dataset.wApprove, "approve", b)));
  list.querySelectorAll("[data-w-reject]").forEach((b) => b.addEventListener("click", () => handleWithdraw(b.dataset.wReject, "reject", b)));
}

async function handleWithdraw(reqId, action, btnEl) {
  const row = btnEl.closest(".admin-row");
  row.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const reqRef = doc(db, "withdrawRequests", reqId);
    await runTransaction(db, async (t) => {
      const reqDoc = await t.get(reqRef);
      if (!reqDoc.exists()) throw new Error("Sorğu tapılmadı.");
      const reqData = reqDoc.data();
      if (reqData.status !== "pending") throw new Error("Bu sorğu artıq icra olunub.");

      if (action === "approve") {
        // Balans artıq sorğu yaradılanda tutulub — sadəcə statusu "ödənildi" et.
        t.update(reqRef, { status: "completed", processedAt: Date.now() });
      } else {
        // Rədd — tutulan məbləği istifadəçiyə geri qaytar.
        const userRef = doc(db, "users", reqData.uid);
        t.update(userRef, { balance: increment(Number(reqData.amount) || 0) });
        t.update(reqRef, { status: "rejected", processedAt: Date.now() });
      }
    });
    showToast(action === "approve" ? "Ödəniş qeydə alındı!" : "Sorğu rədd edildi, balans geri qaytarıldı.", "success");
  } catch (err) {
    showToast(err.message || "Xəta baş verdi.", "error");
    row.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

/* ---- Maşınlar (CRUD) ---- */
function renderAdminProducts() {
  const list = $("admin-products-list");
  if (!list || !isAdmin) return;
  if (globalProducts.length === 0) {
    list.innerHTML = `<div class="empty-state card"><div class="empty-icon">🚗</div><div class="empty-title">Hələ maşın əlavə olunmayıb</div></div>`;
    return;
  }
  list.innerHTML = globalProducts.map((p) => `
    <div class="card admin-row">
      <div class="admin-row-top">
        <div>
          <div style="font-weight:800;">${escapeHTML(p.name)}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">${escapeHTML(p.category)} · ${fmt(p.price)} · +${fmt(p.dailyIncome || p.income)}/gün</div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-ghost btn-sm" data-edit-product="${p.id}">✎ Redaktə et</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-edit-product]").forEach((b) => b.addEventListener("click", () => openProductForm(b.dataset.editProduct)));
}

$("add-product-btn")?.addEventListener("click", () => openProductForm(null));

function openProductForm(productId) {
  editingProductId = productId;
  const p = productId ? globalProducts.find((x) => x.id === productId) : null;
  $("product-modal-title").textContent = p ? "Maşını Redaktə Et" : "Yeni Maşın";
  $("pf-id").value = productId || "";
  $("pf-name").value = p?.name || "";
  $("pf-category").value = p?.category || "sport";
  $("pf-price").value = p?.price || "";
  $("pf-income").value = p?.dailyIncome || p?.income || "";
  $("pf-hp").value = p?.hp || "";
  $("pf-engine").value = p?.engine || "";
  $("pf-speed").value = p?.speed || "";
  $("pf-image").value = p?.image || "";
  $("product-delete-btn").classList.toggle("hidden", !productId);
  openModal("product-modal");
}

$("product-save-btn")?.addEventListener("click", async () => {
  const name = $("pf-name").value.trim();
  const price = Number($("pf-price").value);
  const dailyIncome = Number($("pf-income").value);
  if (!name || !price || !dailyIncome) { showToast("Ad, qiymət və gündəlik gəlir mütləqdir!", "error"); return; }

  const payload = {
    name,
    category: $("pf-category").value,
    price,
    dailyIncome,
    hp: $("pf-hp").value.trim(),
    engine: $("pf-engine").value.trim(),
    speed: $("pf-speed").value.trim(),
    image: $("pf-image").value.trim()
  };

  const btn = $("product-save-btn");
  btn.disabled = true; btn.textContent = "Yadda saxlanılır...";
  try {
    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), payload);
      showToast("Maşın yeniləndi!", "success");
    } else {
      await addDoc(collection(db, "products"), { ...payload, createdAt: Date.now() });
      showToast("Yeni maşın əlavə olundu!", "success");
    }
    closeModal("product-modal");
  } catch (err) {
    showToast("Xəta baş verdi (admin icazəniz olduğuna əmin olun).", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Yadda Saxla";
  }
});

$("product-delete-btn")?.addEventListener("click", async () => {
  if (!editingProductId) return;
  if (!confirm("Bu maşını silmək istədiyinizə əminsiniz? Bu geri qaytarıla bilməz.")) return;
  const btn = $("product-delete-btn");
  btn.disabled = true; btn.textContent = "Silinir...";
  try {
    await deleteDoc(doc(db, "products", editingProductId));
    showToast("Maşın silindi.", "success");
    closeModal("product-modal");
  } catch (err) {
    showToast("Xəta baş verdi.", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Maşını Sil";
  }
});

/* ---- İstifadəçilər ---- */
async function loadAdminUsers() {
  try {
    const snap = await getDocs(collection(db, "users"));
    adminUsersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAdminUsers("");
  } catch (err) {
    console.error("İstifadəçilər oxunmadı:", err);
    $("admin-users-list").innerHTML = `<p style="text-align:center;color:var(--negative);">Yüklənmədi.</p>`;
  }
}

function renderAdminUsers(searchTerm) {
  const list = $("admin-users-list");
  if (!list) return;
  const term = (searchTerm || "").toLowerCase();
  const filtered = adminUsersCache.filter((u) =>
    !term || (u.name || "").toLowerCase().includes(term) || (u.email || "").toLowerCase().includes(term)
  ).slice(0, 60);

  if (filtered.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:16px 0;">Nəticə tapılmadı.</p>`;
    return;
  }

  list.innerHTML = filtered.map((u) => `
    <div class="card admin-row">
      <div class="admin-row-top">
        <div>
          <div style="font-weight:800;">${escapeHTML(u.name || "İstifadəçi")} ${u.role === "admin" ? '<span class="badge badge-blue">Admin</span>' : ""} ${u.isBanned ? '<span class="badge badge-red">Bloklu</span>' : ""}</div>
          <div style="font-size:11.5px;color:var(--text-muted);">${escapeHTML(u.email || "")}</div>
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">Balans: <span class="mono">${fmt(u.balance)}</span> · Referal: ${u.referralsCount || 0}</div>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn ${u.isBanned ? "btn-success" : "btn-danger"} btn-sm" data-ban-toggle="${u.id}" data-current="${!!u.isBanned}">
          ${u.isBanned ? "Blokdan çıxar" : "Blokla"}
        </button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-ban-toggle]").forEach((b) => {
    b.addEventListener("click", async () => {
      const uid = b.dataset.banToggle;
      const willBan = b.dataset.current !== "true";
      if (uid === auth.currentUser.uid) { showToast("Öz hesabınızı bloklaya bilməzsiniz!", "error"); return; }
      b.disabled = true;
      try {
        await updateDoc(doc(db, "users", uid), { isBanned: willBan });
        const cached = adminUsersCache.find((u) => u.id === uid);
        if (cached) cached.isBanned = willBan;
        showToast(willBan ? "İstifadəçi bloklandı." : "Blok götürüldü.", "success");
        renderAdminUsers($("admin-user-search")?.value || "");
      } catch (err) {
        showToast("Xəta baş verdi.", "error");
        b.disabled = false;
      }
    });
  });
}
