(() => {
const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

class AngleReservationDemo {
  constructor(mount) {
    this.mount = mount;
    this.state = { view: "start" };
    this.runId = 0;
    this.manual = false;
    this.statusTimer = 0;
    this.mount.innerHTML = '<div class="angle-reserve-app"></div><span class="angle-demo-pointer" aria-hidden="true"></span>';
    this.app = this.mount.querySelector(".angle-reserve-app");
    this.pointer = this.mount.querySelector(".angle-demo-pointer");
    this.onClick = this.onClick.bind(this);
    this.mount.addEventListener("click", this.onClick);
    this.render();
    this.observeVisibility();
  }

  observeVisibility() {
    const panel = this.mount.closest(".guest-preview-reservations");
    if (!panel) return;
    const sync = () => panel.classList.contains("is-active") ? this.startAuto() : this.stopAuto();
    this.observer = new MutationObserver(sync);
    this.observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
    sync();
  }

  stopAuto() {
    this.runId += 1;
    window.clearTimeout(this.statusTimer);
    this.pointer.classList.remove("is-visible", "is-pressing");
  }

  startAuto() {
    this.stopAuto();
    this.state = { view: "start" };
    this.render();
    this.manual = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.manual) return;
    const id = this.runId;
    window.setTimeout(() => this.play(id), 500);
  }

  isCurrent(id) {
    return id === this.runId && !this.manual;
  }

  async pause(id, duration) {
    await wait(duration);
    return this.isCurrent(id);
  }

  async play(id) {
    if (!await this.pause(id, 550)) return;
    this.setPointer(22, this.mount.clientHeight - 28);
    this.pointer.classList.add("is-visible");

    if (!await this.tap(id, "reservation-search")) return;
    if (!await this.pause(id, 650)) return;
    if (!await this.tap(id, "reservation-slot")) return;
    if (!await this.pause(id, 650)) return;
    if (!await this.tap(id, "reservation-confirm")) return;
    if (!await this.pause(id, 1650)) return;
    this.pointer.classList.remove("is-visible");
  }

  async tap(id, name) {
    if (!this.isCurrent(id)) return false;
    const target = this.app.querySelector(`[data-reserve-target="${name}"]`);
    if (!target) return false;
    await this.movePointer(target, 900);
    if (!this.isCurrent(id)) return false;
    this.pointer.classList.add("is-pressing");
    await wait(155);
    if (!this.isCurrent(id)) return false;
    target.click();
    this.pointer.classList.remove("is-pressing");
    await wait(155);
    return this.isCurrent(id);
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
    const node = event.target.closest("[data-reserve-action]");
    if (!node || !this.mount.contains(node)) return;
    if (event.isTrusted) {
      this.manual = true;
      this.stopAuto();
    }

    const action = node.dataset.reserveAction;
    if (action === "reset") {
      this.manual = false;
      this.startAuto();
      return;
    }
    if (action === "search") this.state.view = "availability";
    if (action === "slot") this.state.view = "details";
    if (action === "confirm") this.state.view = "waiting";
    if (action === "new") this.state.view = "start";
    if (action === "back") {
      if (this.state.view === "details") this.state.view = "availability";
      else this.state.view = "start";
    }
    this.render();
    if (action === "confirm") this.scheduleSuccess();
  }

  scheduleSuccess() {
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      if (this.state.view !== "waiting") return;
      this.state.view = "success";
      this.render();
    }, 1450);
  }

  header({ back = false } = {}) {
    return `<header class="angle-reserve-header">
      <span></span>
      <h3>ANGLE</h3>
      ${back ? '<button class="angle-reserve-back" type="button" data-reserve-action="back">חזרה</button>' : '<span></span>'}
    </header>`;
  }

  summary() {
    // Подписи «אורחים / תאריך / שעה» убраны: значения говорят сами за себя
    // («2 אורחים», «היום», «19:30»), а мелкий текст над ними только шумел.
    return `<div class="angle-reserve-summary">
      <span><strong>2 אורחים</strong></span>
      <span><strong>היום</strong></span>
      <span><strong>19:30</strong></span>
    </div>`;
  }

  renderStart() {
    return `<section class="angle-reserve-screen angle-reserve-start">
      <div class="angle-reserve-scroll">
        <div class="angle-reserve-hero">
          <img src="uploads/reservation-step-1.png" alt="">
        </div>
        <div class="angle-reserve-start-content">
          <div class="angle-reserve-brand"><span>ANGLE</span></div>
          ${this.summary()}
          <button class="angle-reserve-primary" type="button" data-reserve-action="search" data-reserve-target="reservation-search">להזמין עכשיו</button>
          <p class="angle-reserve-hint">בחרו תאריך, שעה וכמות אורחים</p>
          <div class="angle-reserve-hours">
            <div class="angle-reserve-hours-copy"><strong>שעות פעילות</strong><div class="angle-reserve-hours-row"><b>א׳–ה׳</b><span>08:00–20:00</span></div><div class="angle-reserve-hours-row"><b>שישי</b><span>08:00–15:00</span></div><div class="angle-reserve-hours-row"><b>שבת</b><span>סגור</span></div></div>
            <div class="angle-reserve-map">ניווט</div>
          </div>
        </div>
        <footer class="angle-reserve-footer"><div class="angle-reserve-socials"><span aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 22v-8.7h2.9l.44-3.4H13.7V7.72c0-.98.27-1.65 1.68-1.65h1.8V3.03c-.31-.04-1.38-.13-2.63-.13-2.6 0-4.38 1.59-4.38 4.5v2.5H7.23v3.4h2.94V22h3.53Z"/></svg></span><span aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle class="social-dot" cx="17.45" cy="6.65" r="1"/></svg></span></div><div class="angle-reserve-review">★ השאירו ביקורת בגוגל</div></footer>
      </div>
    </section>`;
  }

  timeButtons(zone, featured) {
    return ["19:15", "19:30", "19:45", "20:00"].map((time) => {
      const isTarget = zone === "פרגולה" && time === "19:30";
      return `<button class="angle-reserve-time${time === featured ? " is-featured" : ""}" type="button" data-reserve-action="slot"${isTarget ? ' data-reserve-target="reservation-slot"' : ""}><strong>${time}</strong><small>אישור מיידי</small></button>`;
    }).join("");
  }

  renderAvailability() {
    return `<section class="angle-reserve-screen"><div class="angle-reserve-scroll">
      ${this.header({ back: true })}
      <main class="angle-reserve-availability">
        <small>חזרה לחיפוש</small><h4>מצאנו מספר מקומות פנויים עבורך</h4><p>היום · 19:30 · 2 אורחים</p>
        <div class="angle-reserve-zone"><h5>פרגולה</h5><div class="angle-reserve-times">${this.timeButtons("פרגולה", "19:30")}</div></div>
        <div class="angle-reserve-zone"><h5>רחוב</h5><div class="angle-reserve-times">${this.timeButtons("רחוב", "19:30")}</div></div>
        <div class="angle-reserve-zone"><h5>ורנדה</h5><div class="angle-reserve-times">${this.timeButtons("ורנדה", "19:30")}</div></div>
      </main>
    </div></section>`;
  }

  renderDetails() {
    return `<section class="angle-reserve-screen"><div class="angle-reserve-scroll">
      ${this.header({ back: true })}
      <main class="angle-reserve-details">
        ${this.summary()}
        <div class="angle-reserve-area">אזור: <strong>פרגולה</strong></div>
        <h4>להשלמת ההזמנה יש למלא את הפרטים הבאים</h4>
        <input class="angle-reserve-field" value="אבי כהן" aria-label="שם" readonly>
        <input class="angle-reserve-field" value="05X-XXX-XXXX" aria-label="טלפון" dir="ltr" readonly>
        <input class="angle-reserve-field" placeholder="הערה (לא חובה)" aria-label="הערה" readonly>
        <button class="angle-reserve-confirm" type="button" data-reserve-action="confirm" data-reserve-target="reservation-confirm">לאישור ההזמנה</button>
      </main>
    </div></section>`;
  }

  renderWaiting() {
    return `<section class="angle-reserve-screen">${this.header()}<div class="angle-reserve-status"><div class="angle-reserve-spinner"></div><h4>מאשרים את ההזמנה</h4><p>זה ייקח רק רגע.</p></div></section>`;
  }

  renderSuccess() {
    return `<section class="angle-reserve-screen">${this.header()}<div class="angle-reserve-status"><div class="angle-reserve-success-icon">✓</div><h4>ההזמנה אושרה!</h4><p>מחכים לכם. אם התכניות משתנות, אפשר לבטל את ההזמנה.</p><div class="angle-reserve-confirm-card"><strong>יום ג׳, 17 ביולי, 19:30</strong><span>אבי כהן · 2 אורחים · פרגולה · שולחן 1</span></div><button class="angle-reserve-new" type="button" data-reserve-action="new">הזמנה חדשה</button></div></section>`;
  }

  render() {
    if (this.state.view === "start") this.app.innerHTML = this.renderStart();
    if (this.state.view === "availability") this.app.innerHTML = this.renderAvailability();
    if (this.state.view === "details") this.app.innerHTML = this.renderDetails();
    if (this.state.view === "waiting") this.app.innerHTML = this.renderWaiting();
    if (this.state.view === "success") this.app.innerHTML = this.renderSuccess();
  }
}

const init = () => {
  document.querySelectorAll("[data-angle-reserve-demo]").forEach((mount) => {
    if (!mount.angleReservationDemo) mount.angleReservationDemo = new AngleReservationDemo(mount);
  });
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
})();
