
import {
  auth, db, storage,
  GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged, updateProfile,
  collection, doc, addDoc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, writeBatch, runTransaction, increment,
  ref, uploadBytes, getDownloadURL
} from "./firebase.js";

const app = document.getElementById("app");
const bootLoader = document.getElementById("bootLoader");

const STATE = {
  user: null,
  userDoc: null,
  page: "feed",
  storeUid: null,
  productId: null,
  activePurchase: null,
  products: [],
  myProducts: [],
  purchases: [],
  storeProducts: [],
  storeReviews: [],
  feedUnsub: null,
  myProductsUnsub: null,
  purchasesUnsub: null,
  storeProductsUnsub: null,
  storeReviewsUnsub: null,
  usersCache: new Map(),
  rewardScanRunning: false
};

const rewardWindowMs = 12 * 60 * 60 * 1000;

function uidShort(uid) {
  return uid ? uid.slice(0, 6).toUpperCase() : "USER";
}

function money(n) {
  const num = Number(n || 0);
  return `${num.toLocaleString("ru-RU")} токенов`;
}

function timeAgo(ms) {
  if (!ms) return "только что";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} д назад`;
}

function ratingStars(value) {
  const rounded = Math.round(value || 0);
  return "★".repeat(rounded) + "☆".repeat(Math.max(0, 5 - rounded));
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initialsFromName(name) {
  const text = (name || "U").trim().split(/\s+/).slice(0, 2).map(p => p[0]).join("").toUpperCase();
  return text || "U";
}

function avatarFor(user) {
  return user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName || "User")}&background=1e293b&color=fff&bold=true&size=128`;
}

function toast(message) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function ensureUserDoc(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  const baseData = {
    uid: user.uid,
    name: user.displayName || (user.isAnonymous ? `Аноним ${uidShort(user.uid)}` : "Пользователь"),
    avatar: avatarFor(user),
    tokens: 50,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isAnonymous: !!user.isAnonymous
  };

  if (!snap.exists()) {
    await setDoc(userRef, baseData);
    return baseData;
  }

  const data = snap.data();
  const patch = {
    updatedAt: Date.now(),
    name: data.name || baseData.name,
    avatar: data.avatar || baseData.avatar
  };
  if (typeof data.tokens !== "number") patch.tokens = 50;
  await setDoc(userRef, patch, { merge: true });
  return { ...baseData, ...data, ...patch };
}

async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

async function signInAnon() {
  await signInAnonymously(auth);
}

function signOutNow() {
  return signOut(auth);
}

function clearListeners() {
  [
    "feedUnsub",
    "myProductsUnsub",
    "purchasesUnsub",
    "storeProductsUnsub",
    "storeReviewsUnsub"
  ].forEach(key => {
    if (typeof STATE[key] === "function") {
      STATE[key]();
    }
    STATE[key] = null;
  });
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="hero">
          <div class="kicker">Avito × Ozon × токены</div>
          <h1>Mini Market</h1>
          <p>
            Небольшой маркетплейс на Firebase: вход через Google или анонимно,
            товары в ленте, покупка за токены, отзывы и страницы магазинов.
          </p>
          <div class="badges">
            <div class="badge">Темная тема</div>
            <div class="badge">Glass UI</div>
            <div class="badge">Firestore realtime</div>
            <div class="badge">Storage фото</div>
          </div>
        </div>
        <div class="auth-panel">
          <h2>Войти в приложение</h2>
          <p>После входа откроется главная лента и профиль. Анонимный вход тоже работает.</p>
          <div class="auth-actions">
            <button class="btn" id="googleBtn">Войти через Google</button>
            <button class="btn secondary" id="anonBtn">Войти анонимно</button>
          </div>
          <p class="help">Для Google-аутентификации и анонимного входа нужно включить провайдеры в Firebase Console.</p>
        </div>
      </div>
    </div>
  `;

  document.getElementById("googleBtn").onclick = async () => {
    try {
      await signInGoogle();
    } catch (e) {
      toast("Не удалось войти через Google");
      console.error(e);
    }
  };
  document.getElementById("anonBtn").onclick = async () => {
    try {
      await signInAnon();
    } catch (e) {
      toast("Не удалось войти анонимно");
      console.error(e);
    }
  };
}

function renderAppShell() {
  const user = STATE.user;
  const userDoc = STATE.userDoc || {};
  app.innerHTML = `
    <div class="header">
      <div class="brand">
        <div class="logo"><span>🛒</span></div>
        <div>
          Mini Market
          <small>маркетплейс на Firebase</small>
        </div>
      </div>
      <div class="header-right">
        <div class="user-chip">
          <img class="avatar" src="${escapeHtml(userDoc.avatar || avatarFor(user))}" alt="avatar">
          <div class="user-meta">
            <div class="name">${escapeHtml(userDoc.name || user.displayName || "Пользователь")}</div>
            <div class="sub">${money(userDoc.tokens || 0)}</div>
          </div>
        </div>
        <button class="btn small ghost" id="logoutBtn">Выйти</button>
      </div>
    </div>

    <div class="nav">
      <button data-page="feed" class="${STATE.page === "feed" ? "active" : ""}">Лента</button>
      <button data-page="add" class="${STATE.page === "add" ? "active" : ""}">Добавить товар</button>
      <button data-page="profile" class="${STATE.page === "profile" ? "active" : ""}">Профиль</button>
      <button data-page="store" class="${STATE.page === "store" && STATE.storeUid === STATE.user.uid ? "active" : ""}">Мой магазин</button>
    </div>

    <main id="content"></main>

    <div id="detailModal" class="detail-modal"></div>
  `;

  document.getElementById("logoutBtn").onclick = async () => {
    try {
      await signOutNow();
    } catch (e) {
      console.error(e);
    }
  };

  document.querySelectorAll(".nav button").forEach(btn => {
    btn.onclick = () => {
      const page = btn.dataset.page;
      if (page === "store") {
        STATE.page = "store";
        STATE.storeUid = STATE.user.uid;
      } else {
        STATE.page = page;
      }
      STATE.productId = null;
      renderContent();
    };
  });

  renderContent();
}

function renderContent() {
  const content = document.getElementById("content");
  if (!content) return;

  if (STATE.page === "feed") {
    content.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>Главная лента</h2>
            <p>Карточки товаров в стиле Ozon. Нажми на товар, чтобы открыть детали.</p>
          </div>
          <div class="kicker">Товаров: ${STATE.products.length}</div>
        </div>
        <div id="feedGrid" class="grid"></div>
      </section>
    `;
    renderFeed();
  }

  if (STATE.page === "add") {
    content.innerHTML = `
      <section class="panel">
        <div class="section-head">
          <div>
            <h2>Добавить товар</h2>
            <p>За публикацию начисляется +20 токенов.</p>
          </div>
        </div>

        <form id="productForm" class="form">
          <div class="full">
            <label class="label">Название</label>
            <input class="input" name="title" maxlength="90" required placeholder="Например: Беспроводные наушники" />
          </div>
          <div class="full">
            <label class="label">Описание</label>
            <textarea class="textarea" name="description" maxlength="1200" required placeholder="Коротко опиши товар..."></textarea>
          </div>
          <div>
            <label class="label">Цена в токенах</label>
            <input class="input" name="price" type="number" min="1" required placeholder="120" />
          </div>
          <div>
            <label class="label">Фото товара</label>
            <div class="file-box">
              <input class="input" id="photoInput" name="photo" type="file" accept="image/*" required />
              <img id="photoPreview" class="file-preview" alt="preview" />
            </div>
          </div>
          <div class="full">
            <button class="btn success" type="submit">Опубликовать и получить +20 токенов</button>
          </div>
        </form>
      </section>
    `;

    const photoInput = document.getElementById("photoInput");
    const photoPreview = document.getElementById("photoPreview");
    photoInput?.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      photoPreview.src = url;
      photoPreview.style.display = "block";
    });

    document.getElementById("productForm").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const title = form.title.value.trim();
      const description = form.description.value.trim();
      const price = Number(form.price.value);

      const file = form.photo.files?.[0];
      if (!file) return toast("Выбери фото товара");
      if (!title || !description || !price) return toast("Заполни все поля");

      try {
        const productRef = doc(collection(db, "products"));
        const path = `products/${STATE.user.uid}/${productRef.id}/${Date.now()}_${file.name}`;
        const imageRef = ref(storage, path);
        await uploadBytes(imageRef, file);
        const photoURL = await getDownloadURL(imageRef);

        const batch = writeBatch(db);
        batch.set(productRef, {
          id: productRef.id,
          title,
          description,
          price,
          photoURL,
          sellerUid: STATE.user.uid,
          sellerName: STATE.userDoc.name,
          sellerAvatar: STATE.userDoc.avatar,
          createdAt: Date.now(),
          sold: false,
          soldToUid: null,
          soldToName: null,
          soldAt: null
        });
        batch.update(doc(db, "users", STATE.user.uid), {
          tokens: increment(20),
          updatedAt: Date.now()
        });
        await batch.commit();

        toast("Товар опубликован. +20 токенов");
        form.reset();
        photoPreview.style.display = "none";
        photoPreview.src = "";
        STATE.page = "feed";
        renderContent();
      } catch (err) {
        console.error(err);
        toast("Не удалось опубликовать товар");
      }
    };
  }

  if (STATE.page === "profile") {
    content.innerHTML = `
      <section class="profile-layout">
        <div class="profile-card panel">
          <div style="display:flex;align-items:center;gap:14px;">
            <img class="avatar big" src="${escapeHtml(STATE.userDoc.avatar || avatarFor(STATE.user))}" alt="avatar">
            <div>
              <h2 style="margin:0 0 6px;">${escapeHtml(STATE.userDoc.name || "Пользователь")}</h2>
              <div class="muted">${STATE.user.isAnonymous ? "Анонимный аккаунт" : "Аккаунт Google"}</div>
            </div>
          </div>
          <div class="stats">
            <div class="stat"><strong>${STATE.userDoc.tokens || 0}</strong><span>токенов</span></div>
            <div class="stat"><strong>${STATE.myProducts.length}</strong><span>мои товары</span></div>
            <div class="stat"><strong>${STATE.purchases.length}</strong><span>покупки</span></div>
            <div class="stat"><strong>${STATE.user.uid.slice(0, 6).toUpperCase()}</strong><span>ID</span></div>
          </div>
        </div>

        <div class="panel">
          <div class="tabs">
            <button class="active" data-tab="mine">Мои товары</button>
            <button data-tab="bought">Покупки</button>
          </div>
          <div id="profileList"></div>
        </div>
      </section>
    `;

    const profileList = document.getElementById("profileList");
    const renderMine = () => {
      if (!STATE.myProducts.length) {
        profileList.innerHTML = `<div class="empty">Ты ещё не добавлял товары.</div>`;
        return;
      }
      profileList.innerHTML = `<div class="small-list">${
        STATE.myProducts.map(p => `
          <div class="mini-row">
            <div class="left">
              <img src="${escapeHtml(p.photoURL)}" alt="">
              <div class="txt">
                <strong>${escapeHtml(p.title)}</strong>
                <p>${money(p.price)} • ${p.sold ? "продан" : "в продаже"}</p>
              </div>
            </div>
            <button class="btn small secondary" data-open-product="${p.id}">Открыть</button>
          </div>
        `).join("")
      }</div>`;
    };
    const renderBought = () => {
      if (!STATE.purchases.length) {
        profileList.innerHTML = `<div class="empty">Покупок пока нет.</div>`;
        return;
      }
      profileList.innerHTML = `<div class="small-list">${
        STATE.purchases.map(p => `
          <div class="mini-row">
            <div class="left">
              <img src="${escapeHtml(p.photoURL)}" alt="">
              <div class="txt">
                <strong>${escapeHtml(p.productTitle)}</strong>
                <p>${money(p.price)} • ${timeAgo(p.boughtAt)}</p>
              </div>
            </div>
            <button class="btn small secondary" data-open-product="${p.productId}">Товар</button>
          </div>
        `).join("")
      }</div>`;
    };

    renderMine();
    document.querySelectorAll(".tabs button").forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (btn.dataset.tab === "mine") renderMine();
        else renderBought();
      };
    });

    profileList.addEventListener("click", e => {
      const target = e.target.closest("[data-open-product]");
      if (!target) return;
      openProduct(target.dataset.openProduct);
    });
  }

  if (STATE.page === "store") {
    renderStore();
  }
}

function renderFeed() {
  const grid = document.getElementById("feedGrid");
  if (!grid) return;

  if (!STATE.products.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Пока нет товаров. Добавь первый — и он сразу появится в ленте.</div>`;
    return;
  }

  grid.innerHTML = STATE.products.map(p => `
    <article class="card" data-product="${p.id}">
      <img class="card-img" src="${escapeHtml(p.photoURL)}" alt="">
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(p.title)}</h3>
        <div class="card-row">
          <div class="price">${escapeHtml(String(p.price))} ток.</div>
          <div class="kicker">${p.sold ? "Продан" : "В продаже"}</div>
        </div>
        <div class="seller" data-seller="${p.sellerUid}">
          <img class="mini-avatar" src="${escapeHtml(p.sellerAvatar || avatarFor({displayName:p.sellerName}))}" alt="">
          <div class="muted" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.sellerName)}</div>
        </div>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-product]").forEach(card => {
    card.onclick = () => openProduct(card.dataset.product);
  });

  grid.querySelectorAll("[data-seller]").forEach(el => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      STATE.page = "store";
      STATE.storeUid = el.dataset.seller;
      renderContent();
    };
  });
}

async function openProduct(productId) {
  const p = STATE.products.find(x => x.id === productId)
    || STATE.myProducts.find(x => x.id === productId)
    || STATE.storeProducts.find(x => x.id === productId);

  if (!p) return toast("Товар не найден");
  STATE.productId = productId;

  const modal = document.getElementById("detailModal");
  const userBought = STATE.purchases.some(x => x.productId === productId);
  const purchase = STATE.purchases.find(x => x.productId === productId);

  const reviewsSnap = await getDocs(query(collection(db, "reviews"), where("productId", "==", productId), orderBy("createdAt", "desc")));
  const reviews = reviewsSnap.docs.map(d => d.data());

  modal.innerHTML = `
    <div class="detail-card">
      <button class="btn small ghost close-x" id="closeDetail">Закрыть</button>
      <div class="detail-top">
        <img class="detail-image" src="${escapeHtml(p.photoURL)}" alt="">
        <div class="detail-info">
          <div class="kicker">${p.sold ? "Товар продан" : "В продаже"}</div>
          <h2>${escapeHtml(p.title)}</h2>
          <div class="seller" style="margin:12px 0 4px;cursor:pointer" id="detailSeller">
            <img class="mini-avatar" src="${escapeHtml(p.sellerAvatar || avatarFor({displayName:p.sellerName}))}" alt="">
            <div>
              <strong>${escapeHtml(p.sellerName)}</strong>
              <div class="muted">магазин продавца</div>
            </div>
          </div>
          <div class="price">${escapeHtml(String(p.price))} токенов</div>
          <p class="muted" style="line-height:1.6">${escapeHtml(p.description)}</p>

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">
            <button class="btn success" id="buyBtn" ${p.sold || p.sellerUid === STATE.user.uid ? "disabled" : ""}>Купить</button>
            <button class="btn secondary" id="openStoreBtn">Магазин продавца</button>
          </div>

          <div class="help">
            После покупки товар появляется в «Покупках». Отзыв можно оставить только покупателю.
          </div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="detail-box">
          <h3 style="margin-top:0">Отзывы</h3>
          ${userBought && purchase && !purchase.reviewLeft ? `
            <form id="reviewForm" class="form" style="margin-top:10px">
              <div class="full">
                <label class="label">Оценка</label>
                <select class="select" name="rating" required>
                  <option value="5">5 — супер</option>
                  <option value="4">4 — хорошо</option>
                  <option value="3">3 — нормально</option>
                  <option value="2">2 — слабовато</option>
                  <option value="1">1 — плохо</option>
                </select>
              </div>
              <div class="full">
                <label class="label">Отзыв</label>
                <textarea class="textarea" name="text" maxlength="700" required placeholder="Напиши отзыв после покупки..."></textarea>
              </div>
              <div class="full">
                <button class="btn" type="submit">Оставить отзыв и получить +10 токенов</button>
              </div>
            </form>
          ` : `
            <div class="help">${userBought ? "Отзыв уже оставлен." : "Чтобы оставить отзыв, сначала купи товар."}</div>
          `}
        </div>
        <div class="detail-box">
          <h3 style="margin-top:0">Список отзывов</h3>
          <div class="review-list">
            ${reviews.length ? reviews.map(r => `
              <div class="review">
                <div class="review-head">
                  <strong>${escapeHtml(r.buyerName || "Покупатель")}</strong>
                  <span class="stars">${ratingStars(r.rating)}</span>
                </div>
                <div>${escapeHtml(r.text || "")}</div>
                <div class="help">${timeAgo(r.createdAt)} • ${r.rewardStatus === "paid" ? "токены выданы" : r.rewardStatus === "pending" ? "ожидает проверки" : "обработан"}</div>
                ${STATE.user.uid === p.sellerUid && r.rewardStatus === "pending" ? `
                  <button class="btn small warning" data-approve-review="${r.id || ""}" data-review-product="${p.id}">Одобрить и выдать +10</button>
                ` : ""}
              </div>
            `).join("") : `<div class="empty">Пока нет отзывов.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;

  modal.classList.add("show");
  document.getElementById("closeDetail").onclick = closeDetail;
  document.getElementById("detailSeller").onclick = () => {
    STATE.page = "store";
    STATE.storeUid = p.sellerUid;
    closeDetail();
    renderContent();
  };
  document.getElementById("openStoreBtn").onclick = () => {
    STATE.page = "store";
    STATE.storeUid = p.sellerUid;
    closeDetail();
    renderContent();
  };

  const buyBtn = document.getElementById("buyBtn");
  buyBtn?.addEventListener("click", async () => {
    await buyProduct(p);
  });

  const reviewForm = document.getElementById("reviewForm");
  reviewForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    await leaveReview(p, purchase, Number(form.rating.value), form.text.value.trim());
  });

  modal.querySelectorAll("[data-approve-review]").forEach(btn => {
    btn.onclick = async () => {
      const reviewId = btn.dataset.approveReview;
      await approveReview(reviewId || null, p.id);
    };
  });

  modal.onclick = (e) => {
    if (e.target === modal) closeDetail();
  };
}

function closeDetail() {
  const modal = document.getElementById("detailModal");
  modal.classList.remove("show");
  modal.innerHTML = "";
}

async function buyProduct(product) {
  if (product.sellerUid === STATE.user.uid) return toast("Нельзя купить свой товар");
  try {
    await runTransaction(db, async (transaction) => {
      const productRef = doc(db, "products", product.id);
      const userRef = doc(db, "users", STATE.user.uid);
      const sellerRef = doc(db, "users", product.sellerUid);

      const [productSnap, userSnap, sellerSnap] = await Promise.all([
        transaction.get(productRef),
        transaction.get(userRef),
        transaction.get(sellerRef)
      ]);

      if (!productSnap.exists()) throw new Error("Товар уже не найден");
      const current = productSnap.data();
      if (current.sold) throw new Error("Товар уже продан");

      const buyer = userSnap.data();
      if ((buyer?.tokens || 0) < current.price) throw new Error("Недостаточно токенов");

      transaction.update(userRef, {
        tokens: increment(-current.price),
        updatedAt: Date.now()
      });
      transaction.update(productRef, {
        sold: true,
        soldToUid: STATE.user.uid,
        soldToName: STATE.userDoc.name,
        soldAt: Date.now()
      });
      const purchaseRef = doc(collection(db, "purchases"));
      transaction.set(purchaseRef, {
        id: purchaseRef.id,
        buyerUid: STATE.user.uid,
        buyerName: STATE.userDoc.name,
        sellerUid: product.sellerUid,
        sellerName: product.sellerName,
        productId: product.id,
        productTitle: product.title,
        photoURL: product.photoURL,
        price: product.price,
        boughtAt: Date.now(),
        reviewLeft: false
      });
    });

    toast("Покупка успешна");
    closeDetail();
  } catch (e) {
    console.error(e);
    toast(e.message || "Не удалось купить товар");
  }
}

async function leaveReview(product, purchase, rating, text) {
  try {
    const purchaseRef = doc(db, "purchases", purchase.id);
    const reviewRef = doc(collection(db, "reviews"));
    await runTransaction(db, async (transaction) => {
      const purchaseSnap = await transaction.get(purchaseRef);
      if (!purchaseSnap.exists()) throw new Error("Покупка не найдена");
      const data = purchaseSnap.data();
      if (data.reviewLeft) throw new Error("Отзыв уже отправлен");

      transaction.update(purchaseRef, { reviewLeft: true });
      transaction.set(reviewRef, {
        id: reviewRef.id,
        productId: product.id,
        productTitle: product.title,
        sellerUid: product.sellerUid,
        sellerName: product.sellerName,
        buyerUid: STATE.user.uid,
        buyerName: STATE.userDoc.name,
        rating,
        text,
        createdAt: Date.now(),
        rewardStatus: "pending",
        rewardDueAt: Date.now() + rewardWindowMs,
        rewardGrantedAt: null
      });
    });

    toast("Отзыв отправлен. Он принесёт токены после проверки или через 12 часов.");
    closeDetail();
  } catch (e) {
    console.error(e);
    toast(e.message || "Не удалось оставить отзыв");
  }
}

async function approveReview(reviewId, productId) {
  if (!reviewId) {
    const revSnap = await getDocs(query(collection(db, "reviews"), where("productId", "==", productId), where("sellerUid", "==", STATE.user.uid), where("rewardStatus", "==", "pending"), orderBy("createdAt", "desc"), limit(1)));
    if (revSnap.empty) return toast("Нет ожидающих отзывов");
    reviewId = revSnap.docs[0].id;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const reviewRef = doc(db, "reviews", reviewId);
      const reviewSnap = await transaction.get(reviewRef);
      if (!reviewSnap.exists()) throw new Error("Отзыв не найден");

      const review = reviewSnap.data();
      if (review.sellerUid !== STATE.user.uid) throw new Error("Это не твой магазин");
      if (review.rewardStatus !== "pending") throw new Error("Отзыв уже обработан");

      const reviewerRef = doc(db, "users", review.buyerUid);
      transaction.update(reviewerRef, {
        tokens: increment(10),
        updatedAt: Date.now()
      });
      transaction.update(reviewRef, {
        rewardStatus: "paid",
        rewardGrantedAt: Date.now(),
        rewardMethod: "seller"
      });
    });

    toast("Токены за отзыв выданы");
    renderStore();
    if (STATE.productId) openProduct(STATE.productId);
  } catch (e) {
    console.error(e);
    toast(e.message || "Не удалось одобрить отзыв");
  }
}

async function scanAutoRewards() {
  if (STATE.rewardScanRunning || !STATE.user) return;
  STATE.rewardScanRunning = true;
  try {
    const q = query(
      collection(db, "reviews"),
      where("rewardStatus", "==", "pending"),
      where("rewardDueAt", "<=", Date.now()),
      orderBy("rewardDueAt", "asc"),
      limit(20)
    );
    const snap = await getDocs(q);
    for (const reviewDoc of snap.docs) {
      const review = reviewDoc.data();
      const reviewRef = doc(db, "reviews", reviewDoc.id);
      await runTransaction(db, async (transaction) => {
        const fresh = await transaction.get(reviewRef);
        if (!fresh.exists()) return;
        const current = fresh.data();
        if (current.rewardStatus !== "pending") return;
        if (current.rewardDueAt > Date.now()) return;

        const reviewerRef = doc(db, "users", current.buyerUid);
        transaction.update(reviewerRef, {
          tokens: increment(10),
          updatedAt: Date.now()
        });
        transaction.update(reviewRef, {
          rewardStatus: "paid",
          rewardGrantedAt: Date.now(),
          rewardMethod: "auto"
        });
      });
    }
  } catch (e) {
    console.warn("Auto reward scan skipped", e);
  } finally {
    STATE.rewardScanRunning = false;
  }
}

function attachFeedListener() {
  if (STATE.feedUnsub) STATE.feedUnsub();
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"), limit(80));
  STATE.feedUnsub = onSnapshot(q, snap => {
    STATE.products = snap.docs.map(d => d.data());
    if (STATE.page === "feed") renderContent();
  });
}

function attachMyProductsListener() {
  if (STATE.myProductsUnsub) STATE.myProductsUnsub();
  const q = query(collection(db, "products"), where("sellerUid", "==", STATE.user.uid), orderBy("createdAt", "desc"));
  STATE.myProductsUnsub = onSnapshot(q, snap => {
    STATE.myProducts = snap.docs.map(d => d.data());
    if (STATE.page === "profile") renderContent();
    if (STATE.page === "store" && STATE.storeUid === STATE.user.uid) renderStore();
  });
}

function attachPurchasesListener() {
  if (STATE.purchasesUnsub) STATE.purchasesUnsub();
  const q = query(collection(db, "purchases"), where("buyerUid", "==", STATE.user.uid), orderBy("boughtAt", "desc"));
  STATE.purchasesUnsub = onSnapshot(q, snap => {
    STATE.purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (STATE.page === "profile") renderContent();
  });
}

function calcStoreStats(reviews, products) {
  const average = reviews.length
    ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length
    : 0;
  const soldCount = products.filter(p => p.sold).length;
  return {
    rating: average,
    reviewsCount: reviews.length,
    soldCount
  };
}

function renderStore() {
  const content = document.getElementById("content");
  if (!content) return;
  const isMine = STATE.storeUid === STATE.user.uid;
  const storeProducts = STATE.storeProducts.filter(p => p.sellerUid === STATE.storeUid);
  const stats = calcStoreStats(STATE.storeReviews, storeProducts);
  const storeOwnerName = isMine ? STATE.userDoc.name : (STATE.storeProducts[0]?.sellerName || "Магазин");
  const ownerAvatar = isMine ? STATE.userDoc.avatar : (STATE.storeProducts[0]?.sellerAvatar || avatarFor({displayName: storeOwnerName}));

  content.innerHTML = `
    <section class="panel">
      <div class="section-head">
        <div class="seller" style="gap:14px">
          <img class="avatar big" src="${escapeHtml(ownerAvatar)}" alt="">
          <div>
            <h2 style="margin:0">${escapeHtml(storeOwnerName)}${isMine ? "" : ""}</h2>
            <p>Магазин продавца • рейтинг ${stats.rating ? stats.rating.toFixed(1) : "0.0"} (${stats.reviewsCount})</p>
          </div>
        </div>
        <div class="kicker">Продано: ${stats.soldCount}</div>
      </div>

      <div class="detail-grid">
        <div class="detail-box">
          <h3 style="margin-top:0">Товары магазина</h3>
          <div id="storeProductsBlock"></div>
        </div>
        <div class="detail-box">
          <h3 style="margin-top:0">Отзывы магазина</h3>
          <div id="storeReviewsBlock"></div>
        </div>
      </div>
    </section>
  `;

  const storeProductsBlock = document.getElementById("storeProductsBlock");
  const storeReviewsBlock = document.getElementById("storeReviewsBlock");

  if (!storeProducts.length) {
    storeProductsBlock.innerHTML = `<div class="empty">У этого магазина пока нет товаров.</div>`;
  } else {
    storeProductsBlock.innerHTML = `<div class="small-list">${
      storeProducts.map(p => `
        <div class="mini-row">
          <div class="left">
            <img src="${escapeHtml(p.photoURL)}" alt="">
            <div class="txt">
              <strong>${escapeHtml(p.title)}</strong>
              <p>${money(p.price)} • ${p.sold ? "продан" : "в продаже"}</p>
            </div>
          </div>
          <button class="btn small secondary" data-open-product="${p.id}">Открыть</button>
        </div>
      `).join("")
    }</div>`;
    storeProductsBlock.querySelectorAll("[data-open-product]").forEach(btn => {
      btn.onclick = () => openProduct(btn.dataset.openProduct);
    });
  }

  if (!STATE.storeReviews.length) {
    storeReviewsBlock.innerHTML = `<div class="empty">Пока нет отзывов.</div>`;
  } else {
    storeReviewsBlock.innerHTML = `<div class="review-list">${
      STATE.storeReviews.map(r => `
        <div class="review">
          <div class="review-head">
            <strong>${escapeHtml(r.buyerName || "Покупатель")}</strong>
            <span class="stars">${ratingStars(r.rating)}</span>
          </div>
          <div>${escapeHtml(r.text || "")}</div>
          <div class="help">${timeAgo(r.createdAt)} • ${r.rewardStatus === "paid" ? "токены выданы" : "ожидает проверки"}</div>
          ${isMine && r.rewardStatus === "pending" ? `
            <button class="btn small warning" data-approve-review="${r.id}">Одобрить и выдать +10</button>
          ` : ""}
        </div>
      `).join("")
    }</div>`;
    storeReviewsBlock.querySelectorAll("[data-approve-review]").forEach(btn => {
      btn.onclick = async () => {
        await approveReview(btn.dataset.approveReview, null);
      };
    });
  }
}

function attachStoreListeners(uid) {
  if (STATE.storeProductsUnsub) STATE.storeProductsUnsub();
  if (STATE.storeReviewsUnsub) STATE.storeReviewsUnsub();

  const productsQ = query(collection(db, "products"), where("sellerUid", "==", uid), orderBy("createdAt", "desc"));
  STATE.storeProductsUnsub = onSnapshot(productsQ, snap => {
    STATE.storeProducts = snap.docs.map(d => d.data());
    if (STATE.page === "store" && STATE.storeUid === uid) renderStore();
  });

  const reviewsQ = query(collection(db, "reviews"), where("sellerUid", "==", uid), orderBy("createdAt", "desc"), limit(60));
  STATE.storeReviewsUnsub = onSnapshot(reviewsQ, snap => {
    STATE.storeReviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (STATE.page === "store" && STATE.storeUid === uid) renderStore();
  });
}

function setupPageDefaults() {
  STATE.page = "feed";
  STATE.storeUid = STATE.user.uid;
  STATE.productId = null;
  STATE.activePurchase = null;
}

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      clearListeners();
      STATE.user = null;
      STATE.userDoc = null;
      app.innerHTML = "";
      renderAuth();
      return;
    }

    STATE.user = user;
    STATE.userDoc = await ensureUserDoc(user);
    setupPageDefaults();
    clearListeners();
    renderAppShell();
    attachFeedListener();
    attachMyProductsListener();
    attachPurchasesListener();
    attachStoreListeners(user.uid);
    await scanAutoRewards();
    bootLoader?.remove();
    startRewardTimer();
  } catch (e) {
    console.error(e);
    toast("Ошибка загрузки приложения");
  }
});

function startRewardTimer() {
  if (window._rewardTimer) clearInterval(window._rewardTimer);
  window._rewardTimer = setInterval(() => {
    scanAutoRewards();
    if (STATE.page === "profile") renderContent();
  }, 60 * 1000);
}

window.addEventListener("hashchange", () => {
  // Простая заготовка на будущее, сейчас навигация идёт внутри приложения.
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scanAutoRewards();
});
