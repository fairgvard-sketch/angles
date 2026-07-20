(() => {
const ANGLE_MENU_CATEGORIES = [
  { id: "hot", name: "משקאות חמים", image: "uploads/qr-demo/cappuccino.png" },
  { id: "cold", name: "משקאות קרים", image: "uploads/qr-demo/iced-coffee.png" },
  { id: "pastries", name: "מאפים", image: "uploads/qr-demo/croissant.png" },
  { id: "sandwiches", name: "כריכים", image: "uploads/qr-demo/sandwich-salmon.png" },
  { id: "salads", name: "סלטים", image: "uploads/qr-demo/salad-bulgarit.png" },
  { id: "desserts", name: "גלידה", image: "uploads/qr-demo/ice-cream-classic.png" }
];

const ANGLE_MENU_ITEMS = {
  hot: [
    { id: "espresso", name: "אספרסו", description: "קצר או ארוך, יחיד או כפול.", price: 10, image: "uploads/qr-demo/espresso.png" },
    { id: "macchiato", name: "מקיאטו", description: "אספרסו עם נגיעה של קצף חלב.", price: 11, image: "uploads/qr-demo/macchiato.png" },
    { id: "americano", name: "אמריקנו", description: "אספרסו כפול ומים חמים.", price: 12, image: "uploads/qr-demo/americano.png" },
    { id: "cappuccino", name: "קפוצ׳ינו", description: "הפוך ישראלי.", price: 14, image: "uploads/qr-demo/cappuccino.png", configurable: true },
    { id: "latte", name: "לאטה", description: "חלב מוקצף ואספרסו מעל.", price: 16, image: "uploads/qr-demo/latte.png" },
    { id: "raf", name: "ראף", description: "משקה חם על בסיס שמנת, וניל ואספרסו.", price: 22, image: "uploads/qr-demo/raf.png" }
  ],
  pastries: [
    { id: "croissant", name: "קרואסון צרפתי קלאסי", description: "בצק חמאה צרפתי.", price: 7, image: "uploads/qr-demo/croissant.png" },
    { id: "chocolate-croissant", name: "קרואסון שוקולד", description: "מקל שוקולד אחד, בגודל כיס.", price: 8, image: "uploads/qr-demo/chocolate-croissant.png" },
    { id: "cinnamon-roll", name: "רול קינמון", description: "גלגול הדוק עם קינמון.", price: 16, image: "uploads/qr-demo/cinnamon-roll.png" },
    { id: "vanilla-roll", name: "רול וניל צימוקים", description: "קרם וניל, צימוקים שמנמנים ובצק אפוי רך.", price: 16, image: "uploads/qr-demo/cinnamon-roll.png" },
    { id: "apple-pie", name: "שרסון תפוח עץ", description: "תפוח מקורמל במאפה חמאה פריך.", price: 18, image: "uploads/qr-demo/apple-pie.png" }
  ],
  cold: [
    { id: "iced-latte", name: "לאטה קר", description: "אספרסו, חלב וקרח.", price: 18, image: "uploads/qr-demo/iced-coffee.png" },
    { id: "iced-americano", name: "אמריקנו קר", description: "אספרסו כפול על קרח.", price: 14, image: "uploads/qr-demo/americano.png" }
  ],
  sandwiches: [
    { id: "salmon-sandwich", name: "כריך סלמון", description: "לחם מחמצת, סלמון וירקות.", price: 32, image: "uploads/qr-demo/sandwich-salmon.png" }
  ],
  salads: [
    { id: "house-salad", name: "סלט הבית", description: "ירקות טריים וגבינה בולגרית.", price: 36, image: "uploads/qr-demo/salad-bulgarit.png" }
  ],
  desserts: [
    { id: "vanilla-ice-cream", name: "גלידת וניל", description: "שלושה כדורים.", price: 24, image: "uploads/qr-demo/ice-cream-classic.png" }
  ]
};

const money = (value) => `<span dir="ltr">₪${value}</span>`;
const pause = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

class AngleMenuDemo {
  constructor(mount) {
    this.mount = mount;
    this.state = this.initialState();
    this.runId = 0;
    this.manual = false;
    this.statusTimer = 0;
    this.mount.innerHTML = '<div class="angle-menu-app"></div><span class="angle-demo-pointer" aria-hidden="true"></span>';
    this.app = this.mount.querySelector(".angle-menu-app");
    this.pointer = this.mount.querySelector(".angle-demo-pointer");
    this.onClick = this.onClick.bind(this);
    this.mount.addEventListener("click", this.onClick);
    this.render();
    this.observeVisibility();
  }

  initialState() {
    return {
      view: "categories",
      category: null,
      product: null,
      selectedSize: "small",
      cart: [],
      orderNumber: 1
    };
  }

  observeVisibility() {
    const panel = this.mount.closest(".guest-preview-qr");
    if (!panel) return;
    const sync = () => {
      if (panel.classList.contains("is-active")) this.startAuto();
      else this.stopAuto();
    };
    this.visibilityObserver = new MutationObserver(sync);
    this.visibilityObserver.observe(panel, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  stopAuto() {
    this.runId += 1;
    window.clearTimeout(this.statusTimer);
    this.pointer.classList.remove("is-visible", "is-pressing");
  }

  resetState() {
    this.state = this.initialState();
    this.render();
  }

  startAuto() {
    this.stopAuto();
    this.resetState();
    this.manual = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.manual) return;
    const id = this.runId;
    window.setTimeout(() => this.play(id), 450);
  }

  isCurrentRun(id) {
    return id === this.runId && !this.manual;
  }

  async wait(id, duration) {
    await pause(duration);
    return this.isCurrentRun(id);
  }

  async play(id) {
    if (!await this.wait(id, 450)) return;
    this.setPointer(22, this.mount.clientHeight - 30);
    this.pointer.classList.add("is-visible");

    if (!await this.tap(id, "category-hot")) return;
    if (!await this.wait(id, 600)) return;
    if (!await this.tap(id, "item-cappuccino")) return;
    if (!await this.wait(id, 600)) return;
    if (!await this.tap(id, "add-product")) return;
    if (!await this.wait(id, 600)) return;
    if (!await this.tap(id, "chip-pastries")) return;
    if (!await this.wait(id, 600)) return;
    if (!await this.tap(id, "item-cinnamon-roll")) return;
    if (!await this.wait(id, 600)) return;
    if (!await this.tap(id, "open-cart")) return;
    if (!await this.wait(id, 650)) return;

    const checkout = this.app.querySelector(".angle-menu-scroll");
    if (checkout) {
      checkout.scrollTo({ top: checkout.scrollHeight, behavior: "smooth" });
      if (!await this.wait(id, 800)) return;
    }

    if (!await this.tap(id, "submit-order")) return;
    if (!await this.wait(id, 1550)) return;
    this.pointer.classList.remove("is-visible");
  }

  async tap(id, name) {
    if (!this.isCurrentRun(id)) return false;
    const target = this.app.querySelector(`[data-demo-target="${name}"]`);
    if (!target) return false;
    await this.movePointer(target, 860);
    if (!this.isCurrentRun(id)) return false;
    this.pointer.classList.add("is-pressing");
    await pause(150);
    if (!this.isCurrentRun(id)) return false;
    target.click();
    this.pointer.classList.remove("is-pressing");
    await pause(150);
    return this.isCurrentRun(id);
  }

  setPointer(left, top) {
    this.pointer.style.left = `${left}px`;
    this.pointer.style.top = `${top}px`;
  }

  targetCenter(target) {
    const mountRect = this.mount.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scaleX = mountRect.width / this.mount.offsetWidth || 1;
    const scaleY = mountRect.height / this.mount.offsetHeight || 1;
    return {
      left: (targetRect.left + targetRect.width / 2 - mountRect.left) / scaleX,
      top: (targetRect.top + targetRect.height / 2 - mountRect.top) / scaleY
    };
  }

  async movePointer(target, duration) {
    const destination = this.targetCenter(target);
    const currentLeft = Number.parseFloat(this.pointer.style.left) || this.mount.clientWidth / 2;
    const currentTop = Number.parseFloat(this.pointer.style.top) || this.mount.clientHeight * 0.9;
    this.pointer.classList.add("is-visible");
    const animation = this.pointer.animate([
      { left: `${currentLeft}px`, top: `${currentTop}px` },
      { left: `${destination.left}px`, top: `${destination.top}px` }
    ], {
      duration,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "forwards"
    });
    try {
      await animation.finished;
    } catch {
      return;
    }
    this.setPointer(destination.left, destination.top);
    animation.cancel();
  }

  onClick(event) {
    const actionNode = event.target.closest("[data-demo-action]");
    if (!actionNode || !this.mount.contains(actionNode)) return;
    if (event.isTrusted) {
      this.manual = true;
      this.stopAuto();
    }
    const action = actionNode.dataset.demoAction;
    const value = actionNode.dataset.demoValue;

    if (action === "reset") {
      this.manual = false;
      this.startAuto();
      return;
    }
    if (action === "open-category") {
      this.state.view = "list";
      this.state.category = value;
      this.state.product = null;
    }
    if (action === "open-product") {
      this.state.view = "product";
      this.state.product = value;
      this.state.selectedSize = "small";
    }
    if (action === "select-size") this.state.selectedSize = value;
    if (action === "add-product") {
      const item = this.findItem(this.state.product);
      if (item) this.addCartItem(item, this.state.selectedSize === "large" ? 16 : item.price, this.state.selectedSize === "large" ? "גדול" : "קטן");
      this.state.view = "list";
      this.state.category = "hot";
      this.state.product = null;
    }
    if (action === "add-simple") {
      const item = this.findItem(value);
      if (item) this.addCartItem(item, item.price, null);
    }
    if (action === "open-cart") this.state.view = "checkout";
    if (action === "submit") this.state.view = "waiting";
    if (action === "new-order") this.state = this.initialState();
    if (action === "back") {
      if (this.state.view === "product") this.state.view = "list";
      else if (this.state.view === "checkout") this.state.view = "list";
      else {
        this.state.view = "categories";
        this.state.category = null;
      }
    }
    this.render();
    if (action === "submit") this.scheduleSuccess();
  }

  scheduleSuccess() {
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      if (this.state.view !== "waiting") return;
      this.state.view = "success";
      this.render();
    }, 1350);
  }

  addCartItem(item, price, variant) {
    const existing = this.state.cart.find((line) => line.id === item.id && line.variant === variant);
    if (existing) existing.qty += 1;
    else this.state.cart.push({ id: item.id, name: item.name, price, variant, qty: 1 });
  }

  findItem(id) {
    return Object.values(ANGLE_MENU_ITEMS).flat().find((item) => item.id === id) || null;
  }

  cartCount() {
    return this.state.cart.reduce((sum, item) => sum + item.qty, 0);
  }

  cartTotal() {
    return this.state.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  header({ back = false, reset = true } = {}) {
    return `
      <header class="angle-menu-header">
        ${reset ? '<button class="angle-menu-reset" type="button" data-demo-action="reset" title="Restart demo" aria-label="Restart demo">↻</button>' : '<span></span>'}
        <h3>לחמנייה</h3>
        ${back ? '<button class="angle-menu-back" type="button" data-demo-action="back">חזרה</button>' : '<span></span>'}
      </header>`;
  }

  categoryCards() {
    return ANGLE_MENU_CATEGORIES.map((category) => `
      <button class="angle-category-card" type="button" data-demo-action="open-category" data-demo-value="${category.id}" data-demo-target="category-${category.id}">
        <img src="${category.image}" alt="">
        <span>${category.name}</span>
      </button>`).join("");
  }

  chips() {
    return `<nav class="angle-menu-chips" aria-label="קטגוריות">
      ${ANGLE_MENU_CATEGORIES.map((category) => `
        <button class="angle-menu-chip${category.id === this.state.category ? " is-active" : ""}" type="button" data-demo-action="open-category" data-demo-value="${category.id}" data-demo-target="chip-${category.id}">${category.name}</button>`).join("")}
    </nav>`;
  }

  listItems() {
    const items = ANGLE_MENU_ITEMS[this.state.category] || [];
    return items.map((item) => {
      const action = item.configurable ? "open-product" : "add-simple";
      return `
        <button class="angle-menu-item" type="button" data-demo-action="${action}" data-demo-value="${item.id}" data-demo-target="item-${item.id}">
          <img src="${item.image}" alt="">
          <span class="angle-menu-item-copy">
            <strong>${item.name}</strong>
            <small>${item.description}</small>
            <span class="angle-menu-item-price">מ־ ${money(item.price)}</span>
          </span>
        </button>`;
    }).join("");
  }

  cartDock() {
    if (this.cartCount() === 0) return "";
    return `
      <button class="angle-cart-dock" type="button" data-demo-action="open-cart" data-demo-target="open-cart">
        <span class="angle-cart-count">${this.cartCount()}</span>
        <span class="angle-cart-label">הצג פריטים</span>
        <span class="angle-cart-total">${money(this.cartTotal())}</span>
      </button>`;
  }

  renderCategories() {
    return `
      <section class="angle-menu-screen angle-menu-start">
        <div class="angle-menu-scroll">
          <div class="angle-menu-start-content">
            <div class="angle-menu-hero"><span>תפריט דיגיטלי</span><strong>לחמנייה</strong></div>
            <div class="angle-menu-categories">${this.categoryCards()}</div>
          </div>
          <footer class="angle-menu-footer">
            <div class="angle-menu-socials" aria-label="Social media">
              <span aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 22v-8.7h2.9l.44-3.4H13.7V7.72c0-.98.27-1.65 1.68-1.65h1.8V3.03c-.31-.04-1.38-.13-2.63-.13-2.6 0-4.38 1.59-4.38 4.5v2.5H7.23v3.4h2.94V22h3.53Z"/></svg></span>
              <span aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle class="social-dot" cx="17.45" cy="6.65" r="1"/></svg></span>
            </div>
            <div class="angle-menu-review">★ השאירו ביקורת בגוגל</div>
          </footer>
        </div>
        ${this.cartDock()}
      </section>`;
  }

  renderList() {
    const category = ANGLE_MENU_CATEGORIES.find((item) => item.id === this.state.category) || ANGLE_MENU_CATEGORIES[0];
    return `
      <section class="angle-menu-screen">
        <div class="angle-menu-scroll">
          ${this.header({ back: true })}
          ${this.chips()}
          <main class="angle-menu-list">
            <h4>${category.name}</h4>
            <div class="angle-menu-items">${this.listItems()}</div>
          </main>
        </div>
        ${this.cartDock()}
      </section>`;
  }

  renderProduct() {
    const item = this.findItem(this.state.product) || this.findItem("cappuccino");
    const smallActive = this.state.selectedSize === "small";
    return `
      <section class="angle-menu-screen">
        <div class="angle-menu-scroll">
          ${this.header({ back: true })}
          ${this.chips()}
          <main class="angle-menu-list"><h4>משקאות חמים</h4><div class="angle-menu-items">${this.listItems()}</div></main>
        </div>
        <div class="angle-product-backdrop"></div>
        <div class="angle-product-sheet">
          <button class="angle-product-close" type="button" data-demo-action="back" aria-label="Close">×</button>
          <img class="angle-product-image" src="${item.image}" alt="">
          <h4>${item.name}</h4>
          <p class="angle-product-description">${item.description}</p>
          <div class="angle-option-row">
            <button class="angle-option${smallActive ? " is-active" : ""}" type="button" data-demo-action="select-size" data-demo-value="small">קטן · ${money(14)}</button>
            <button class="angle-option${smallActive ? "" : " is-active"}" type="button" data-demo-action="select-size" data-demo-value="large">גדול · ${money(16)}</button>
          </div>
          <div class="angle-option-label">בסיס חלב</div>
          <div class="angle-option-row"><button class="angle-option" type="button">סויה +2₪</button><button class="angle-option" type="button">שיבולת שועל +2₪</button></div>
          <div class="angle-option-label">חוזק</div>
          <div class="angle-option-row"><button class="angle-option" type="button">חלש</button><button class="angle-option" type="button">חזק</button></div>
        </div>
        <button class="angle-product-add" type="button" data-demo-action="add-product" data-demo-target="add-product">להוסיף ${money(smallActive ? 14 : 16)}</button>
      </section>`;
  }

  renderCheckout() {
    return `
      <section class="angle-menu-screen">
        <div class="angle-menu-scroll">
          ${this.header({ back: true })}
          <main class="angle-checkout">
            <div class="angle-checkout-lines">
              ${this.state.cart.map((line) => `
                <div class="angle-checkout-line">
                  <span><strong>${line.name}</strong>${line.variant ? `<small>${line.variant}</small>` : ""}</span>
                  <span class="angle-checkout-stepper"><button type="button">+</button><span>${line.qty}</span><button type="button">−</button></span>
                  <span class="angle-checkout-price">${money(line.price * line.qty)}</span>
                </div>`).join("")}
            </div>
            <div class="angle-checkout-total"><span>סה״כ</span><span dir="ltr">₪${this.cartTotal()}</span></div>
            <p class="angle-checkout-hint">התשלום בקופה בעת האיסוף</p>
            <h4>איך תרצו לקבל?</h4>
            <div class="angle-order-types">
              <button class="angle-order-type is-active" type="button">כאן</button>
              <button class="angle-order-type" type="button">לקחת</button>
              <button class="angle-order-type" type="button">משלוח</button>
            </div>
            <h4>פרטי קשר</h4>
            <input class="angle-field" value="אבי כהן" aria-label="השם שלך" readonly>
            <input class="angle-field" value="05X-XXX-XXXX" aria-label="טלפון" readonly dir="ltr">
            <div class="angle-time-types" style="margin-top:7px">
              <button class="angle-time-type is-active" type="button">בהקדם האפשרי · ~20–45</button>
              <button class="angle-time-type" type="button">לשעה</button>
            </div>
            <input class="angle-field" placeholder="הערה להזמנה" aria-label="הערה להזמנה" readonly>
            <button class="angle-submit-order" type="button" data-demo-action="submit" data-demo-target="submit-order">לשלוח הזמנה · ${money(this.cartTotal())}</button>
          </main>
        </div>
      </section>`;
  }

  renderWaiting() {
    return `
      <section class="angle-menu-screen">
        ${this.header({ reset: false })}
        <div class="angle-status-screen">
          <div class="angle-status-spinner"></div>
          <h4>ממתינים לאישור בית הקפה</h4>
          <p>בדרך כלל זה לוקח פחות מדקה. אל תסגרו את הדף.</p>
        </div>
      </section>`;
  }

  renderSuccess() {
    return `
      <section class="angle-menu-screen">
        ${this.header({ reset: false })}
        <div class="angle-status-screen">
          <span class="angle-order-number-label">המספר שלך</span>
          <strong class="angle-order-number">#${this.state.orderNumber}</strong>
          <h4>ההזמנה נמסרה</h4>
          <p>תודה! נשמח לראותכם שוב.</p>
          <p style="font-size:14px;font-weight:850;color:#101827" dir="ltr">₪${this.cartTotal()}</p>
          <button class="angle-new-order" type="button" data-demo-action="new-order">הזמנה חדשה</button>
        </div>
      </section>`;
  }

  render() {
    if (this.state.view === "categories") this.app.innerHTML = this.renderCategories();
    if (this.state.view === "list") this.app.innerHTML = this.renderList();
    if (this.state.view === "product") this.app.innerHTML = this.renderProduct();
    if (this.state.view === "checkout") this.app.innerHTML = this.renderCheckout();
    if (this.state.view === "waiting") this.app.innerHTML = this.renderWaiting();
    if (this.state.view === "success") this.app.innerHTML = this.renderSuccess();
  }
}

const initAngleMenuDemos = () => {
  document.querySelectorAll("[data-angle-menu-demo]").forEach((mount) => {
    if (!mount.angleMenuDemo) mount.angleMenuDemo = new AngleMenuDemo(mount);
  });
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAngleMenuDemos, { once: true });
else initAngleMenuDemos();
})();
