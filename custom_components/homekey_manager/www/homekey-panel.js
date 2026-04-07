const DEFAULT_SENSORS = {
  sensor_result: "sensor.magickey_last_hk_result",
  sensor_issuer: "sensor.magickey_last_hk_issuer_id",
  sensor_endpoint: "sensor.magickey_last_hk_endpoint_id",
};

class HomekeyPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._initialized = false;
    this._keys = [];
    this._settings = { ...DEFAULT_SENSORS };
    this._editIdx = null;
    this._lastResultTs = 0;
    this._bannerTimeout = null;
    this._version = "";
    this._pollInterval = null;
  }

  set panel(panel) {
    this._version = panel?.config?.version || "";
    const el = this.shadowRoot.querySelector("#versionTag");
    if (el) el.textContent = "v" + this._version;
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._initialized) {
      this._buildUI();
      this._initData();
      this._initialized = true;
    }
  }

  async _initData() {
    await this._loadSettings();
    await this._loadKeys();
    // Record current endpoint sensor timestamp (changes with every different device scan)
    if (this._hass && this._settings.sensor_endpoint) {
      const epSensor = this._hass.states[this._settings.sensor_endpoint];
      if (epSensor && epSensor.last_updated) {
        this._lastResultTs = new Date(epSensor.last_updated).getTime();
        this._setStatus("online", "Verbunden \u00b7 live");
      }
    }
    // Start polling every 2 seconds for reliable scan detection
    this._startPolling();
  }

  _startPolling() {
    if (this._pollInterval) clearInterval(this._pollInterval);
    this._pollInterval = setInterval(() => this._pollSensor(), 2000);
  }

  _pollSensor() {
    if (!this._hass || !this._settings.sensor_endpoint) return;

    // Watch endpoint sensor for changes (value changes per device, guarantees last_updated update)
    const epSensor = this._hass.states[this._settings.sensor_endpoint];
    if (!epSensor) {
      this._setStatus("offline", "Sensor nicht gefunden");
      return;
    }

    this._setStatus("online", "Verbunden \u00b7 live");

    const ts = new Date(epSensor.last_updated).getTime();
    if (ts > this._lastResultTs) {
      // Check result sensor for success
      const resultSensor = this._hass.states[this._settings.sensor_result];
      if (resultSensor?.state === "success") {
        this._lastResultTs = ts;
        const issuer = this._hass.states[this._settings.sensor_issuer]?.state || "";
        const endpoint = epSensor.state || "";
        if (endpoint && endpoint !== "unknown" && endpoint.length > 2) {
          this._handleScan(issuer, endpoint);
        }
      }
    }
  }

  connectedCallback() {
    if (this._hass && !this._initialized) {
      this._buildUI();
      this._initData();
      this._initialized = true;
    }
  }

  disconnectedCallback() {
    clearInterval(this._statsInterval);
    clearInterval(this._pollInterval);
    this._initialized = false;
  }

  /* ---- API ---- */

  $(sel) { return this.shadowRoot.querySelector(sel); }

  async _api(path, method = "GET", body = null) {
    try {
      const opts = { method };
      if (body) {
        opts.body = JSON.stringify(body);
        opts.headers = { "Content-Type": "application/json" };
      }
      const resp = await this._hass.fetchWithAuth("/api/homekey_manager/" + path, opts);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  async _loadSettings() {
    const data = await this._api("settings");
    if (data) this._settings = data;
  }

  async _loadKeys() {
    const data = await this._api("keys");
    if (data) this._keys = data;
    this._render();
    this._updateStats();
  }

  async _handleScan(issuer, endpoint) {
    // Match by endpoint (unique per device)
    const existing = this._keys.find((k) => k.endpoint === endpoint);
    if (existing) {
      await this._api("keys/" + encodeURIComponent(endpoint), "PUT", {
        lastSeen: new Date().toISOString(),
        scanCount: (existing.scanCount || 0) + 1,
        active: true,
        issuer: issuer,
      });
      this._showBanner("Scan erkannt: " + existing.name);
    } else {
      await this._api("keys", "POST", {
        name: "Unbekannt \u2014 umbenennen",
        issuer, endpoint, active: true,
        lastSeen: new Date().toISOString(),
        scanCount: 1,
        added: new Date().toISOString(),
      });
      this._showBanner("Neuer Key erkannt! Bitte umbenennen.");
    }
    await this._loadKeys();
  }

  /* ---- UI helpers ---- */

  _setStatus(s, t) {
    const dot = this.$("#statusDot");
    const text = this.$("#statusText");
    if (dot) dot.className = "status-dot " + s;
    if (text) text.textContent = t;
  }

  _showBanner(msg) {
    const b = this.$("#scanBanner");
    if (!b) return;
    b.textContent = msg;
    b.classList.add("visible");
    clearTimeout(this._bannerTimeout);
    this._bannerTimeout = setTimeout(() => b.classList.remove("visible"), 6000);
  }

  _colorFor(s) {
    const colors = [
      { bg: "#1a2a4a", text: "#8ab4f8" }, { bg: "#1a3a2a", text: "#81c995" },
      { bg: "#3a1a1a", text: "#f28b82" }, { bg: "#2a1a3a", text: "#c58af9" },
      { bg: "#3a2a1a", text: "#fdd663" }, { bg: "#1a3a3a", text: "#78d9ec" },
    ];
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(h) % colors.length];
  }

  _initials(n) {
    return n.trim().split(" ").map((w) => w[0] || "").join("").toUpperCase().slice(0, 2) || "?";
  }

  _timeAgo(iso) {
    if (!iso) return "\u2014";
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "Gerade eben";
    if (m < 60) return "vor " + m + " Min.";
    const h = Math.floor(m / 60);
    if (h < 24) return "vor " + h + " Std.";
    return "vor " + Math.floor(h / 24) + " Tagen";
  }

  _isToday(iso) {
    return iso && new Date(iso).toDateString() === new Date().toDateString();
  }

  _esc(s) {
    const el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }

  /* ---- Render ---- */

  _render() {
    const q = (this.$("#searchInput")?.value || "").toLowerCase();
    const filtered = this._keys.filter(
      (k) => k.name.toLowerCase().includes(q) || (k.endpoint || "").toLowerCase().includes(q) || (k.issuer || "").toLowerCase().includes(q)
    );
    const list = this.$("#keyList");
    if (!list) return;

    if (!filtered.length) {
      list.innerHTML = '<div class="empty">Noch keine Keys erfasst.<br><br>Halte iPhone oder Apple Watch an den NFC-Reader \u2014<br>der Key erscheint automatisch hier.</div>';
      return;
    }

    list.innerHTML = filtered.map((k) => {
      const idx = this._keys.indexOf(k);
      const col = this._colorFor(k.endpoint || k.issuer || "?");
      const active = k.active && this._isToday(k.lastSeen);
      return '<div class="card"><div class="key-header">' +
        '<div class="avatar" style="background:' + col.bg + ";color:" + col.text + ';">' + this._initials(k.name) + "</div>" +
        '<div class="key-info"><div class="key-name">' + this._esc(k.name) + "</div>" +
        '<div class="key-id">Endpoint: ' + this._esc(k.endpoint || "\u2014") + "</div>" +
        '<div class="key-id">Issuer: ' + this._esc(k.issuer || "\u2014") + "</div></div>" +
        '<span class="badge ' + (active ? "badge-active" : "badge-inactive") + '">' + (active ? "aktiv" : "inaktiv") + "</span>" +
        '<div class="key-actions"><button class="btn" data-edit="' + idx + '"><span>Umbenennen</span></button>' +
        '<button class="btn btn-danger" data-delete="' + idx + '"><span>L\u00f6schen</span></button></div></div>' +
        '<div class="key-meta"><span>Letzter Scan: <span class="meta-val">' + this._timeAgo(k.lastSeen) + "</span></span>" +
        '<span>Scans: <span class="meta-val">' + (k.scanCount || 0) + "</span></span>" +
        '<span>Hinzugef\u00fcgt: <span class="meta-val">' + (k.added ? new Date(k.added).toLocaleDateString("de-DE") : "\u2014") + "</span></span>" +
        "</div></div>";
    }).join("");

    list.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => this._showRename(parseInt(btn.dataset.edit)))
    );
    list.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => this._deleteKey(parseInt(btn.dataset.delete)))
    );
  }

  _updateStats() {
    const total = this.$("#statTotal");
    const today = this.$("#statToday");
    const last = this.$("#statLast");
    if (total) total.textContent = this._keys.length;
    if (today) today.textContent = this._keys.filter((k) => this._isToday(k.lastSeen)).length;
    if (last) {
      const sorted = [...this._keys].filter((k) => k.lastSeen).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
      last.textContent = sorted.length ? this._timeAgo(sorted[0].lastSeen) : "\u2014";
    }
  }

  /* ---- Rename Modal ---- */

  _showRename(idx) {
    this._editIdx = idx;
    this.$("#mName").value = this._keys[idx].name;
    this.$("#modalOverlay").style.display = "flex";
    setTimeout(() => this.$("#mName").focus(), 50);
  }

  _closeModal() { this.$("#modalOverlay").style.display = "none"; this._editIdx = null; }

  async _saveRename() {
    const name = this.$("#mName").value.trim();
    if (!name) { alert("Name erforderlich"); return; }
    await this._api("keys/" + encodeURIComponent(this._keys[this._editIdx].endpoint), "PUT", { name });
    await this._loadKeys();
    this._closeModal();
  }

  async _deleteKey(idx) {
    if (!confirm('"' + this._keys[idx].name + '" wirklich l\u00f6schen?')) return;
    await this._api("keys/" + encodeURIComponent(this._keys[idx].endpoint), "DELETE");
    await this._loadKeys();
  }

  /* ---- Settings Modal ---- */

  async _showSettings() {
    await this._loadSettings();
    this.$("#sResult").value = this._settings.sensor_result || "";
    this.$("#sIssuer").value = this._settings.sensor_issuer || "";
    this.$("#sEndpoint").value = this._settings.sensor_endpoint || "";
    this.$("#settingsOverlay").style.display = "flex";
  }

  _closeSettings() { this.$("#settingsOverlay").style.display = "none"; }

  async _saveSettings() {
    const result = await this._api("settings", "PUT", {
      sensor_result: this.$("#sResult").value.trim(),
      sensor_issuer: this.$("#sIssuer").value.trim(),
      sensor_endpoint: this.$("#sEndpoint").value.trim(),
    });
    if (result) {
      this._settings = result;
      this._lastResultTs = 0;
      const epSensor = this._hass.states[this._settings.sensor_endpoint];
      if (epSensor) this._lastResultTs = new Date(epSensor.last_updated).getTime();
      this._showBanner("Einstellungen gespeichert");
      this._startPolling();
    }
    this._closeSettings();
  }

  /* ---- Dropdown ---- */

  _toggleMenu() {
    const menu = this.$("#dropdownMenu");
    menu.classList.toggle("visible");
    if (menu.classList.contains("visible")) {
      const close = (e) => {
        if (!menu.contains(e.composedPath()[0])) {
          menu.classList.remove("visible");
          document.removeEventListener("click", close, true);
        }
      };
      setTimeout(() => document.addEventListener("click", close, true), 0);
    }
  }

  /* ---- Build UI ---- */

  _buildUI() {
    this.shadowRoot.innerHTML = `
<style>
  :host {
    display: block;
    --bg: var(--primary-background-color, #111318);
    --card-bg: var(--ha-card-background, var(--card-background-color, #1e2124));
    --text: var(--primary-text-color, #e8eaed);
    --text2: var(--secondary-text-color, #9aa0a6);
    --border: var(--divider-color, #3c4043);
    --accent: var(--ha-card-header-color, #4a90d9);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; background: var(--card-bg); border-bottom: 1px solid var(--border);
  }
  .toolbar-left { display: flex; align-items: center; gap: 12px; }
  .toolbar-title { font-size: 18px; font-weight: 500; color: var(--text); }
  .version-tag { font-size: 11px; color: var(--text2); margin-left: 6px; }
  .hamburger-btn {
    display: none; background: none; border: none; color: var(--text); cursor: pointer;
    width: 36px; height: 36px; align-items: center; justify-content: center; border-radius: 50%;
  }
  .hamburger-btn:hover { background: rgba(255,255,255,0.1); }
  .menu-wrap { position: relative; }
  .btn { font-size: 13px; padding: 7px 14px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text); cursor: pointer; white-space: nowrap; }
  .btn:hover { background: rgba(255,255,255,0.06); }
  .btn-danger { color: #f28b82; border-color: #5c2b29; }
  .btn-danger:hover { background: #2d1b1b; }
  .btn-primary { background: rgba(74,144,217,0.15); border-color: var(--accent); color: #8ab4f8; }
  .btn-primary:hover { background: rgba(74,144,217,0.25); }
  .dropdown { position: absolute; right: 0; top: 100%; margin-top: 6px; background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; min-width: 210px; display: none; z-index: 50; overflow: hidden; }
  .dropdown.visible { display: block; }
  .dropdown-item { display: block; width: 100%; padding: 11px 16px; font-size: 13px; color: var(--text); background: transparent; border: none; text-align: left; cursor: pointer; }
  .dropdown-item:hover { background: rgba(255,255,255,0.06); }
  .dropdown-sep { height: 1px; background: var(--border); }
  .content { padding: 16px; background: var(--bg); min-height: calc(100vh - 56px); }
  .status-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13px; color: var(--text2); }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #fdd663; flex-shrink: 0; }
  .status-dot.online { background: #81c995; animation: pulse 2s infinite; }
  .status-dot.offline { background: #f28b82; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
  .stat { background: var(--card-bg); border-radius: 10px; padding: 14px; }
  .stat-label { font-size: 12px; color: var(--text2); margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 500; color: var(--text); }
  .scan-banner { background: rgba(74,144,217,0.15); border: 1px solid var(--accent); border-radius: 10px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: #8ab4f8; display: none; }
  .scan-banner.visible { display: block; }
  .toolbar-search { margin-bottom: 14px; }
  .toolbar-search input { width: 100%; background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 14px; color: var(--text); font-size: 14px; outline: none; }
  .toolbar-search input:focus { border-color: var(--accent); }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; }
  .key-header { display: flex; align-items: center; gap: 12px; }
  .avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 500; flex-shrink: 0; }
  .key-info { flex: 1; min-width: 0; }
  .key-name { font-size: 15px; font-weight: 500; color: var(--text); }
  .key-id { font-size: 11px; color: var(--text2); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
  .badge { font-size: 11px; padding: 3px 9px; border-radius: 6px; font-weight: 500; flex-shrink: 0; }
  .badge-active { background: #1e3a2a; color: #81c995; }
  .badge-inactive { background: #3a2e1a; color: #fdd663; }
  .key-actions { display: flex; gap: 8px; margin-left: 8px; }
  .key-meta { display: flex; gap: 20px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text2); flex-wrap: wrap; }
  .meta-val { color: var(--text); font-weight: 500; }
  .empty { text-align: center; padding: 40px 20px; color: var(--text2); font-size: 14px; line-height: 1.8; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 100; }
  .dialog { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 24px; width: 360px; max-width: 90vw; }
  .dialog-title { font-size: 17px; font-weight: 500; margin-bottom: 18px; color: var(--text); }
  .dialog label { font-size: 13px; color: var(--text2); display: block; margin-bottom: 5px; }
  .dialog input { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 14px; outline: none; margin-bottom: 14px; }
  .dialog input:focus { border-color: var(--accent); }
  .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .dialog-hint { font-size: 11px; color: var(--text2); margin-bottom: 14px; }
  @media (max-width: 600px) {
    .hamburger-btn { display: flex; }
    .key-actions .btn span { display: none; }
    .key-actions .btn { padding: 6px 10px; font-size: 16px; }
    .stats { gap: 8px; }
    .stat { padding: 10px; }
    .stat-value { font-size: 18px; }
    .key-header { gap: 8px; }
    .key-meta { gap: 12px; }
  }
</style>
<div class="toolbar">
  <div class="toolbar-left">
    <button class="hamburger-btn" id="btnHamburger">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
    </button>
    <span class="toolbar-title">HomeKey Manager <span class="version-tag" id="versionTag"></span></span>
  </div>
  <div class="menu-wrap">
    <button class="btn" id="btnMenu">\u2699 Einstellungen \u25BE</button>
    <div class="dropdown" id="dropdownMenu">
      <button class="dropdown-item" id="menuSensors">Sensoren konfigurieren</button>
    </div>
  </div>
</div>
<div class="content">
  <div class="status-bar">
    <div class="status-dot" id="statusDot"></div>
    <span id="statusText">Verbinde...</span>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Enrollte Keys</div><div class="stat-value" id="statTotal">0</div></div>
    <div class="stat"><div class="stat-label">Aktiv heute</div><div class="stat-value" id="statToday">0</div></div>
    <div class="stat"><div class="stat-label">Letzter Scan</div><div class="stat-value" style="font-size:15px;padding-top:4px;" id="statLast">\u2014</div></div>
  </div>
  <div id="scanBanner" class="scan-banner"></div>
  <div class="toolbar-search"><input type="text" id="searchInput" placeholder="Keys durchsuchen..."></div>
  <div id="keyList"></div>
</div>
<div id="modalOverlay" class="overlay">
  <div class="dialog">
    <div class="dialog-title">Key umbenennen</div>
    <label>Name / Ger\u00e4t</label>
    <input type="text" id="mName" placeholder="z.B. iPhone">
    <div class="dialog-actions">
      <button class="btn" id="btnCancel">Abbrechen</button>
      <button class="btn btn-primary" id="btnSave">Speichern</button>
    </div>
  </div>
</div>
<div id="settingsOverlay" class="overlay">
  <div class="dialog">
    <div class="dialog-title">Sensoren konfigurieren</div>
    <div class="dialog-hint">Entity-IDs der NFC-Lock Sensoren.</div>
    <label>Result Sensor</label>
    <input type="text" id="sResult" placeholder="sensor.magickey_last_hk_result">
    <label>Issuer Sensor</label>
    <input type="text" id="sIssuer" placeholder="sensor.magickey_last_hk_issuer_id">
    <label>Endpoint Sensor</label>
    <input type="text" id="sEndpoint" placeholder="sensor.magickey_last_hk_endpoint_id">
    <div class="dialog-actions">
      <button class="btn" id="btnSettingsCancel">Abbrechen</button>
      <button class="btn btn-primary" id="btnSettingsSave">Speichern</button>
    </div>
  </div>
</div>`;

    const $ = (s) => this.shadowRoot.querySelector(s);
    $("#btnHamburger").addEventListener("click", () => {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    });
    $("#btnMenu").addEventListener("click", () => this._toggleMenu());
    $("#menuSensors").addEventListener("click", () => { this.$("#dropdownMenu").classList.remove("visible"); this._showSettings(); });
    $("#btnCancel").addEventListener("click", () => this._closeModal());
    $("#btnSave").addEventListener("click", () => this._saveRename());
    $("#modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") this._closeModal(); });
    $("#searchInput").addEventListener("input", () => this._render());
    $("#btnSettingsCancel").addEventListener("click", () => this._closeSettings());
    $("#btnSettingsSave").addEventListener("click", () => this._saveSettings());

    if (this._version) $("#versionTag").textContent = "v" + this._version;
    this._statsInterval = setInterval(() => this._updateStats(), 30000);
  }
}

customElements.define("homekey-panel", HomekeyPanel);
