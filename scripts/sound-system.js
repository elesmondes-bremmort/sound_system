const SOUND_SYSTEM_ID = "sound-system";
const SOUND_SYSTEM_MODULE_ID = "sound_system";
const SOUND_SYSTEM_STORAGE_KEY = "sound-system-window-state";
const SOUND_SYSTEM_VIEW_MODE_KEY = "sound-system-view-mode";
const SOUND_SYSTEM_LOOP_DELAYS_KEY = "sound-system-loop-delays";
const SOUND_SYSTEM_SELECTED_PLAYLIST_KEY = "sound-system-selected-playlist";
const SOUND_SYSTEM_ACTIVE_TIMERS_KEY = "sound-system-active-timers";
const SOUND_SYSTEM_PRESETS_SETTING = "presets";
const SOUND_SYSTEM_AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "wav", "flac", "m4a", "webm"]);

class SoundSystem {
  static instance = null;
  static timedLoops = new Map();

  static open() {
    if (!game.user.isGM) return;

    if (this.instance) {
      this.instance.close();
      return;
    }

    this.instance = new SoundSystem();
    this.instance.render();
  }

  constructor() {
    this.selectedPlaylistId = this.loadSelectedPlaylistId();
    this.selectedSoundKeys = new Set();
    this.lastSelectedIndex = -1;
    this.contextMenu = null;
    this.resizeObserver = null;
    this.position = this.loadPosition();
    this.viewMode = this.loadViewMode();
    this.timedLoops = SoundSystem.timedLoops; // key -> intervalId
    this.loopDelays = this.loadLoopDelays();
    this.clearPersistedActiveTimers();
  }

  loadLoopDelays() {
    try {
      return JSON.parse(localStorage.getItem(SOUND_SYSTEM_LOOP_DELAYS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  saveLoopDelays() {
    try {
      localStorage.setItem(SOUND_SYSTEM_LOOP_DELAYS_KEY, JSON.stringify(this.loopDelays));
    } catch {}
  }

  loadSelectedPlaylistId() {
    try {
      return localStorage.getItem(SOUND_SYSTEM_SELECTED_PLAYLIST_KEY) || null;
    } catch {
      return null;
    }
  }

  saveSelectedPlaylistId() {
    try {
      if (this.selectedPlaylistId) {
        localStorage.setItem(SOUND_SYSTEM_SELECTED_PLAYLIST_KEY, this.selectedPlaylistId);
      } else {
        localStorage.removeItem(SOUND_SYSTEM_SELECTED_PLAYLIST_KEY);
      }
    } catch {}
  }

  clearPersistedActiveTimers() {
    try {
      localStorage.removeItem(SOUND_SYSTEM_ACTIVE_TIMERS_KEY);
    } catch {}
  }

  _timedKey(playlist, sound) {
    return `${playlist.id}:${sound.id}`;
  }

  startTimedLoop(playlist, sound, seconds) {
    const key = `${playlist.id}:${sound.id}`;
    this.stopTimedLoopByKey(key);
    const id = setInterval(async () => {
      try {
        await playlist.playSound(sound);
      } catch {}
    }, Math.max(1, Number(seconds)) * 1000);
    this.timedLoops.set(key, id);
    this.loopDelays[key] = Number(seconds);
    this.saveLoopDelays();
  }

  stopTimedLoop(playlist, sound) {
    const key = `${playlist.id}:${sound.id}`;
    this.stopTimedLoopByKey(key);
  }

  stopTimedLoopByKey(key) {
    if (this.timedLoops.has(key)) {
      const id = this.timedLoops.get(key);
      clearInterval(id);
      this.timedLoops.delete(key);
    }
  }

  stopAllTimers() {
    for (const id of this.timedLoops.values()) clearInterval(id);
    this.timedLoops.clear();
  }

  async toggleTimedLoop(playlist, sound) {
    if (!playlist || !sound) return;
    if (playlist.mode !== CONST.PLAYLIST_MODES.SIMULTANEOUS) return;

    const key = `${playlist.id}:${sound.id}`;
    const existing = this.loopDelays[key];
    const active = this.timedLoops.has(key);

    if (!existing) {
      const seconds = await Dialog.prompt({
        title: "Délai de répétition (secondes)",
        content: `
          <form>
            <div class="form-group">
              <label>Secondes</label>
              <input type="number" name="value" min="1" value="10" />
            </div>
          </form>
        `,
        callback: html => Number(html.find("input[name='value']").val())
      });
      if (!seconds || Number.isNaN(seconds)) return;
      this.loopDelays[key] = Number(seconds);
      this.saveLoopDelays();
      await sound.update({ repeat: false }).catch(() => {});
      this.startTimedLoop(playlist, sound, seconds);
      return;
    }

    if (!active) {
      await sound.update({ repeat: false }).catch(() => {});
      this.startTimedLoop(playlist, sound, existing);
      return;
    }

    this.stopTimedLoop(playlist, sound);
  }

  cleanupDeletedSoundTimer(sound) {
    const soundId = sound?.id;
    if (!soundId) return;

    const playlistId = sound.parent?.id ?? sound.playlist?.id;
    const keys = playlistId
      ? [`${playlistId}:${soundId}`]
      : Array.from(this.timedLoops.keys()).filter(key => key.endsWith(`:${soundId}`));

    let changed = false;
    for (const key of keys) {
      this.stopTimedLoopByKey(key);
      if (key in this.loopDelays) {
        delete this.loopDelays[key];
        changed = true;
      }
    }

    if (changed) this.saveLoopDelays();
  }

  static cleanupDeletedSoundTimer(sound) {
    const soundId = sound?.id;
    if (!soundId) return;

    const playlistId = sound.parent?.id ?? sound.playlist?.id;
    const keys = playlistId
      ? [`${playlistId}:${soundId}`]
      : Array.from(this.timedLoops.keys()).filter(key => key.endsWith(`:${soundId}`));

    for (const key of keys) {
      if (this.timedLoops.has(key)) {
        clearInterval(this.timedLoops.get(key));
        this.timedLoops.delete(key);
      }
      if (this.instance?.loopDelays && key in this.instance.loopDelays) {
        delete this.instance.loopDelays[key];
      }
    }

    try {
      const delays = JSON.parse(localStorage.getItem(SOUND_SYSTEM_LOOP_DELAYS_KEY) || "{}") || {};
      let changed = false;
      for (const key of keys) {
        if (key in delays) {
          delete delays[key];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(SOUND_SYSTEM_LOOP_DELAYS_KEY, JSON.stringify(delays));
    } catch {}
  }

  get allEntries() {
    return game.playlists.contents.flatMap(playlist =>
      playlist.sounds.contents.map(sound => ({ playlist, sound }))
    );
  }

  loadPosition() {
    const fallback = {
      top: 80,
      left: 100,
      width: 1160,
      height: 680
    };

    try {
      const saved = JSON.parse(localStorage.getItem(SOUND_SYSTEM_STORAGE_KEY));

      if (
        !saved ||
        !Number.isFinite(saved.top) ||
        !Number.isFinite(saved.left) ||
        !Number.isFinite(saved.width) ||
        !Number.isFinite(saved.height) ||
        saved.width < 300 ||
        saved.height < 200 ||
        saved.left < 0 ||
        saved.top < 0
      ) {
        localStorage.removeItem(SOUND_SYSTEM_STORAGE_KEY);
        return fallback;
      }

      return { ...fallback, ...saved };
    } catch {
      localStorage.removeItem(SOUND_SYSTEM_STORAGE_KEY);
      return fallback;
    }
  }

  savePosition() {
    if (!this.win || !document.body.contains(this.win)) return;

    const rect = this.win.getBoundingClientRect();

    const nextPosition = {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };

    if (
      !Number.isFinite(nextPosition.top) ||
      !Number.isFinite(nextPosition.left) ||
      !Number.isFinite(nextPosition.width) ||
      !Number.isFinite(nextPosition.height) ||
      nextPosition.width < 300 ||
      nextPosition.height < 200 ||
      nextPosition.left < 0 ||
      nextPosition.top < 0
    ) {
      return;
    }

    this.position = nextPosition;

    localStorage.setItem(
      SOUND_SYSTEM_STORAGE_KEY,
      JSON.stringify(this.position)
    );
  }

  render() {
    document.getElementById(SOUND_SYSTEM_ID)?.remove();

    const win = document.createElement("div");
    win.id = SOUND_SYSTEM_ID;
    win.style.top = `${this.position.top}px`;
    win.style.left = `${this.position.left}px`;
    win.style.width = `${this.position.width}px`;
    win.style.height = `${this.position.height}px`;

    win.innerHTML = `
      <div class="ss-window">
        <div class="ss-header">
          <b>🎵 Sound System</b>
          <button class="ss-close" title="Fermer">×</button>
        </div>

        <div class="ss-main">
          <aside class="ss-tree"></aside>

          <section class="ss-center">
            <input class="ss-search" placeholder="Rechercher un son, une ambiance, une musique..." />
            <div class="ss-results"></div>
          </section>

          <aside class="ss-presets">
            <div class="ss-presets-title"><b>Presets</b></div>
            <button class="ss-save-preset">💾 Sauver preset</button>
            <div class="ss-preset-list"></div>
          </aside>

          <aside class="ss-playing">
            <div class="ss-playing-title"></div>
            <div class="ss-now"></div>
          </aside>
        </div>
      </div>
    `;

    document.body.appendChild(win);

    this.win = win;
    this.tree = win.querySelector(".ss-tree");
    this.results = win.querySelector(".ss-results");
    this.now = win.querySelector(".ss-now");
    this.search = win.querySelector(".ss-search");
    this.playingTitle = win.querySelector(".ss-playing-title");
    this.presets = win.querySelector(".ss-presets");
    this.presetList = win.querySelector(".ss-preset-list");

    this.activateListeners();
    this.renderAll();
    this.search.focus();
  }

  close() {
    this.savePosition();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    document.getElementById(SOUND_SYSTEM_ID)?.remove();
    this.removeContextMenu();

    SoundSystem.instance = null;
  }

  renderAll() {
    this.normalizeSelectedPlaylist();
    this.renderTree();
    this.renderResults();
    this.renderPresets();
    this.renderNowPlaying();
  }

  renderTree() {
    const selectedPlaylist = this.getSelectedPlaylist();
    const isSoundboard = !!selectedPlaylist && selectedPlaylist.mode === CONST.PLAYLIST_MODES.SIMULTANEOUS;

    this.tree.innerHTML = `
      <div class="ss-tree-actions">
        <button class="ss-create-playlist">+ Playlist</button>
        <button class="ss-create-soundboard">+ Soundboard</button>
        <button class="ss-import-sound">Importer un son</button>
        <button class="ss-import-multiple-sounds">Importer plusieurs sons</button>
        <button class="ss-open-opus">🎧 Opus</button>
        ${isSoundboard ? `
          <div class="ss-view-toggle">
            <button class="ss-view-mode ${this.viewMode === "list" ? "active" : ""}" data-mode="list">📋 Liste</button>
            <button class="ss-view-mode ${this.viewMode === "pads" ? "active" : ""}" data-mode="pads">🎛 Pads</button>
          </div>
        ` : ""}
      </div>

      <div class="ss-playlist ${!this.selectedPlaylistId ? "active" : ""}" data-id="">
        📚 Toutes les playlists
      </div>

      ${game.playlists.contents.map(p => `
        <div class="ss-playlist ${this.selectedPlaylistId === p.id ? "active" : ""}" data-id="${p.id}">
          🎵 ${this.escape(p.name)}
          <div class="ss-sub">${p.sounds.size} piste${p.sounds.size > 1 ? "s" : ""}</div>
        </div>
      `).join("")}
    `;
  }

  getFilteredEntries() {
    const q = this.search.value.toLowerCase().trim();

    return this.allEntries
      .filter(({ playlist, sound }) => {
        const matchPlaylist = !this.selectedPlaylistId || playlist.id === this.selectedPlaylistId;
        const matchSearch =
          !q ||
          sound.name.toLowerCase().includes(q) ||
          playlist.name.toLowerCase().includes(q);

        return matchPlaylist && matchSearch;
      })
      .sort((a, b) => a.sound.name.localeCompare(b.sound.name))
      .slice(0, 200);
  }

  getSelectedPlaylist() {
    return this.selectedPlaylistId ? game.playlists.get(this.selectedPlaylistId) : null;
  }

  normalizeSelectedPlaylist() {
    if (!this.selectedPlaylistId) return;
    if (game.playlists.get(this.selectedPlaylistId)) return;

    this.selectedPlaylistId = null;
    this.saveSelectedPlaylistId();
  }

  loadViewMode() {
    const mode = localStorage.getItem(SOUND_SYSTEM_VIEW_MODE_KEY);
    return mode === "pads" ? "pads" : "list";
  }

  saveViewMode(mode) {
    this.viewMode = mode === "pads" ? "pads" : "list";
    localStorage.setItem(SOUND_SYSTEM_VIEW_MODE_KEY, this.viewMode);
  }

  renderResults() {
    const entries = this.getFilteredEntries();
    const selectedPlaylist = this.getSelectedPlaylist();
    const isSoundboard = !!selectedPlaylist && selectedPlaylist.mode === CONST.PLAYLIST_MODES.SIMULTANEOUS;
    const showPads = isSoundboard && this.viewMode === "pads";
    const showTimer = isSoundboard;

    let selectionBar = "";
    if (this.selectedSoundKeys.size > 0) {
      selectionBar = `
        <div class="ss-selection-bar">
          <span>${this.selectedSoundKeys.size} son${this.selectedSoundKeys.size > 1 ? "s" : ""} sélectionné${this.selectedSoundKeys.size > 1 ? "s" : ""}</span>
          <div class="ss-selection-actions">
            <button class="ss-move-to">Déplacer vers...</button>
            <button class="ss-copy-to">Copier vers...</button>
            <button class="ss-delete-selected">Supprimer</button>
            <button class="ss-deselect-all">Désélectionner</button>
          </div>
        </div>
      `;
    }

    this.results.innerHTML = selectionBar + (entries.length
      ? showPads
        ? `<div class="ss-pad-grid">${entries.map(({ playlist, sound }, idx) => {
            const key = `${playlist.id}:${sound.id}`;
            const isSelected = this.selectedSoundKeys.has(key);
            const delay = this.loopDelays[key];
            const timerActive = this.timedLoops.has(key);
            return `
              <div class="ss-pad ${sound.playing ? "playing" : ""} ${timerActive ? "timed-active" : ""} ${isSelected ? "selected" : ""}" draggable="true" data-playlist="${playlist.id}" data-sound="${sound.id}" data-index="${idx}">
                <div class="ss-pad-label">${sound.playing ? "🟢 " : ""}${this.escape(sound.name)}</div>
                <div class="ss-pad-actions">
                  <button class="ss-btn loop ss-pad-loop ${sound.repeat ? "active" : ""}" title="Boucle native">${sound.repeat ? "🔁" : "↻"}</button>
                  <button class="ss-pad-timer ${timerActive ? "active" : ""}" title="Timer">${timerActive ? `⏱ ${delay}s` : (delay ? `⏱ ${delay}s` : `⏱`)}</button>
                </div>
              </div>
            `;
          }).join("")}</div>`
        : entries.map(({ playlist, sound }, idx) => {
            const key = `${playlist.id}:${sound.id}`;
            const isSelected = this.selectedSoundKeys.has(key);
            const delay = this.loopDelays[key];
            const timerActive = this.timedLoops.has(key);
            return `
              <div class="ss-row ${showTimer ? "has-timer" : ""} ${timerActive ? "timed-active" : ""} ${isSelected ? "selected" : ""}" draggable="true" data-playlist="${playlist.id}" data-sound="${sound.id}" data-index="${idx}">
                <button class="ss-btn play" title="Jouer">▶</button>
                <button class="ss-btn stop" title="Arrêter">■</button>
                <button class="ss-btn loop" title="Boucle">${sound.repeat ? "🔁" : "↻"}</button>
                ${showTimer ? `<button class="ss-btn timer ${timerActive ? "active" : ""}" title="Timer">${timerActive ? `⏱ ${delay}s` : (delay ? `⏱ ${delay}s` : `⏱`)}</button>` : ""}

                <div class="ss-name">
                  <span>${sound.playing ? "🟢 " : ""}${this.escape(sound.name)}</span>
                  <div class="ss-sub">${this.escape(playlist.name)}</div>
                </div>
              </div>
            `;
          }).join("")
      : `<p class="ss-empty">Aucun son trouvé.</p>`);
  }

  renderNowPlaying() {
    const entriesByKey = new Map();

    for (const { playlist, sound } of this.allEntries) {
      const key = `${playlist.id}:${sound.id}`;
      if (sound.playing || this.timedLoops.has(key)) entriesByKey.set(key, { playlist, sound });
    }

    for (const key of Array.from(this.timedLoops.keys())) {
      if (entriesByKey.has(key)) continue;

      const [playlistId, soundId] = key.split(":");
      const playlist = game.playlists.get(playlistId);
      const sound = playlist?.sounds?.get(soundId);

      if (playlist && sound) {
        entriesByKey.set(key, { playlist, sound });
        continue;
      }

      this.stopTimedLoopByKey(key);
    }

    const armedOrPlaying = Array.from(entriesByKey.values());
    this.playingTitle.innerHTML = `<b>En cours / Armés (${armedOrPlaying.length})</b>`;

    if (armedOrPlaying.length) {
      this.playingTitle.innerHTML += ` <button class="ss-stop-all" title="Tout arrêter">■ Tout arrêter</button>`;
    }

    this.now.innerHTML = armedOrPlaying.length
      ? armedOrPlaying.map(({ playlist, sound }) => {
          const isSoundboard = playlist.mode === CONST.PLAYLIST_MODES.SIMULTANEOUS;
          const key = `${playlist.id}:${sound.id}`;
          const delay = this.loopDelays[key];
          const timerActive = this.timedLoops.has(key);
          const status = `${sound.playing ? "🟢 " : ""}${timerActive ? "⏱ " : ""}`;
          return `
        <div class="ss-now-row ${isSoundboard ? "has-timer" : ""}" data-playlist="${playlist.id}" data-sound="${sound.id}">
          <button class="ss-btn stop" title="Arrêter">■</button>
          <button class="ss-btn loop" title="Boucle">${sound.repeat ? "🔁" : "↻"}</button>
          ${isSoundboard ? `<button class="ss-btn timer ${timerActive ? "active" : ""}" title="Timer">${timerActive ? `⏱ ${delay}s` : (delay ? `⏱ ${delay}s` : `⏱`)}</button>` : ""}

          <div>
            <div class="ss-name">${status}${this.escape(sound.name)}</div>
            <div class="ss-sub">${this.escape(playlist.name)}</div>
            <input class="volume" type="range" min="0" max="1" step="0.05" value="${sound.volume ?? 0.5}" />
          </div>
        </div>
      `;
        }).join("")
      : `<p class="ss-empty">Aucune piste en cours ou armée.</p>`;
  }

  getPresets() {
    try {
      const presets = game.settings.get(SOUND_SYSTEM_MODULE_ID, SOUND_SYSTEM_PRESETS_SETTING);
      return Array.isArray(presets) ? presets : [];
    } catch {
      return [];
    }
  }

  async savePresets(presets) {
    await game.settings.set(SOUND_SYSTEM_MODULE_ID, SOUND_SYSTEM_PRESETS_SETTING, presets);
  }

  makePresetId() {
    return globalThis.foundry?.utils?.randomID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  captureCurrentAudioState() {
    const entriesByKey = new Map();

    for (const { playlist, sound } of this.allEntries) {
      const key = `${playlist.id}:${sound.id}`;
      if (sound.playing || this.timedLoops.has(key)) entriesByKey.set(key, { playlist, sound });
    }

    return Array.from(entriesByKey.values()).map(({ playlist, sound }) => {
      const key = `${playlist.id}:${sound.id}`;
      const timerSeconds = this.timedLoops.has(key) ? Number(this.loopDelays[key] || 10) : null;
      return {
        playlistId: playlist.id,
        soundId: sound.id,
        volume: sound.volume ?? 0.5,
        repeat: timerSeconds ? false : !!sound.repeat,
        timerSeconds
      };
    });
  }

  renderPresets() {
    if (!this.presetList) return;

    const presets = this.getPresets();
    this.presetList.innerHTML = presets.length
      ? presets.map(preset => `
        <div class="ss-preset" data-preset="${preset.id}">
          <div class="ss-preset-name">${this.escape(preset.name)}</div>
          <div class="ss-preset-actions">
            <button class="ss-preset-play" title="Lancer">▶</button>
            <button class="ss-preset-update" title="Mettre à jour">💾</button>
            <button class="ss-preset-stop" title="Stopper">■</button>
          </div>
        </div>
      `).join("")
      : `<p class="ss-empty">Aucun preset.</p>`;
  }

  async createPresetFromCurrentState() {
    const entries = this.captureCurrentAudioState();
    if (!entries.length) {
      ui.notifications?.warn("Aucun son en cours ou armé à sauvegarder.");
      return;
    }

    const name = await this.promptText("Sauver preset", "Nom", "Nouveau preset");
    if (!name) return;

    const presets = this.getPresets();
    presets.push({
      id: this.makePresetId(),
      name,
      entries
    });

    await this.savePresets(presets);
    this.renderPresets();
  }

  async updatePresetFromCurrentState(presetId) {
    const entries = this.captureCurrentAudioState();
    if (!entries.length) {
      ui.notifications?.warn("Aucun son en cours ou armé à sauvegarder.");
      return;
    }

    const presets = this.getPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    preset.entries = entries;
    await this.savePresets(presets);
    this.renderPresets();
  }

  async playPreset(presetId) {
    const preset = this.getPresets().find(p => p.id === presetId);
    if (!preset) return;

    for (const entry of preset.entries || []) {
      const playlist = game.playlists.get(entry.playlistId);
      const sound = playlist?.sounds?.get(entry.soundId);
      if (!playlist || !sound) continue;

      await sound.update({
        volume: Number.isFinite(Number(entry.volume)) ? Number(entry.volume) : sound.volume ?? 0.5,
        repeat: entry.timerSeconds ? false : !!entry.repeat
      }).catch(() => {});

      await playlist.playSound(sound).catch(() => {});

      if (entry.timerSeconds) {
        this.startTimedLoop(playlist, sound, Number(entry.timerSeconds));
      } else {
        this.stopTimedLoop(playlist, sound);
      }
    }

    this.renderAll();
  }

  async stopPreset(presetId) {
    const preset = this.getPresets().find(p => p.id === presetId);
    if (!preset) return;

    for (const entry of preset.entries || []) {
      const playlist = game.playlists.get(entry.playlistId);
      const sound = playlist?.sounds?.get(entry.soundId);
      if (!playlist || !sound) continue;

      await playlist.stopSound(sound).catch(() => {});
      this.stopTimedLoop(playlist, sound);
    }

    this.renderAll();
  }

  async renamePreset(presetId) {
    const presets = this.getPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const name = await this.promptText("Renommer le preset", "Nom", preset.name);
    if (!name || name === preset.name) return;

    preset.name = name;
    await this.savePresets(presets);
    this.renderPresets();
  }

  async deletePreset(presetId) {
    const presets = this.getPresets();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const confirmed = await Dialog.confirm({
      title: "Supprimer le preset",
      content: `<p>Supprimer <strong>${this.escape(preset.name)}</strong> ?</p>`
    });

    if (!confirmed) return;
    await this.savePresets(presets.filter(p => p.id !== presetId));
    this.renderPresets();
  }

  activateListeners() {
    this.win.querySelector(".ss-close").addEventListener("click", () => this.close());

    this.presets.addEventListener("click", async ev => {
      if (ev.target.closest(".ss-save-preset")) {
        await this.createPresetFromCurrentState();
        return;
      }

      const presetRow = ev.target.closest(".ss-preset");
      if (!presetRow) return;

      const presetId = presetRow.dataset.preset;

      if (ev.target.closest(".ss-preset-play")) {
        await this.playPreset(presetId);
        return;
      }

      if (ev.target.closest(".ss-preset-update")) {
        await this.updatePresetFromCurrentState(presetId);
        return;
      }

      if (ev.target.closest(".ss-preset-stop")) {
        await this.stopPreset(presetId);
      }
    });

    this.presets.addEventListener("contextmenu", ev => {
      const presetRow = ev.target.closest(".ss-preset");
      if (!presetRow) return;

      ev.preventDefault();
      const presetId = presetRow.dataset.preset;

      this.showContextMenu(ev.clientX, ev.clientY, [
        { label: "✏️ Renommer", action: () => this.renamePreset(presetId) },
        { label: "🗑️ Supprimer", danger: true, action: () => this.deletePreset(presetId) }
      ]);
    });

    this.tree.addEventListener("click", async ev => {
      if (ev.target.classList.contains("ss-create-playlist")) {
        await this.createPlaylist(false);
        return;
      }

      if (ev.target.classList.contains("ss-create-soundboard")) {
        await this.createPlaylist(true);
        return;
      }

      if (ev.target.classList.contains("ss-import-sound")) {
        await this.importSound();
        return;
      }

      if (ev.target.classList.contains("ss-import-multiple-sounds")) {
        await this.importMultipleSounds();
        return;
      }

      if (ev.target.classList.contains("ss-open-opus")) {
        this.openOpus();
        return;
      }

      if (ev.target.classList.contains("ss-view-mode")) {
        this.saveViewMode(ev.target.dataset.mode);
        this.renderAll();
        return;
      }

      const item = ev.target.closest(".ss-playlist");
      if (!item) return;

      this.selectedPlaylistId = item.dataset.id || null;
      this.saveSelectedPlaylistId();
      this.selectedSoundKeys.clear();
      this.lastSelectedIndex = -1;
      this.renderAll();
    });

    this.tree.addEventListener("contextmenu", ev => {
      ev.preventDefault();

      const item = ev.target.closest(".ss-playlist");
      const playlist = item?.dataset.id ? game.playlists.get(item.dataset.id) : null;

      const isSoundboard = playlist?.mode === CONST.PLAYLIST_MODES.SIMULTANEOUS;

      this.showContextMenu(ev.clientX, ev.clientY, [
        { label: "➕ Nouvelle playlist", action: () => this.createPlaylist(false) },
        { label: "🎛️ Nouveau soundboard", action: () => this.createPlaylist(true) },
        playlist && { label: "✏️ Renommer", action: () => this.renamePlaylist(playlist) },
        playlist && { 
          label: isSoundboard ? "🎵 Convertir en playlist" : "🎛 Convertir en soundboard",
          action: async () => {
            const newMode = isSoundboard ? CONST.PLAYLIST_MODES.SEQUENTIAL : CONST.PLAYLIST_MODES.SIMULTANEOUS;
            await playlist.update({ mode: newMode });
            ui.notifications?.info(isSoundboard ? "Converti en playlist" : "Converti en soundboard");
            this.renderAll();
          }
        },
        playlist && { label: "🗑️ Supprimer", danger: true, action: () => this.deletePlaylist(playlist) }
      ].filter(Boolean));
    });

    this.search.addEventListener("input", () => {
      this.selectedSoundKeys.clear();
      this.renderResults();
    });

    this.results.addEventListener("contextmenu", async ev => {
      ev.preventDefault();

      const timerEl = ev.target.closest(".timer, .ss-pad-timer");
      if (timerEl) {
        const target = timerEl.closest(".ss-row, .ss-pad");
        if (!target) return;
        const { playlist, sound } = this.getRowData(target);
        if (!playlist || !sound) return;

        const key = `${playlist.id}:${sound.id}`;
        const current = this.loopDelays[key] || 10;
        const seconds = await Dialog.prompt({
          title: "Délai de répétition (secondes)",
          content: `
            <form>
              <div class="form-group">
                <label>Secondes</label>
                <input type="number" name="value" min="1" value="${current}" />
              </div>
            </form>
          `,
          callback: html => Number(html.find("input[name='value']").val())
        });

        if (!seconds || Number.isNaN(seconds)) return;
        this.loopDelays[key] = Number(seconds);
        this.saveLoopDelays();
        if (this.timedLoops.has(key)) {
          // restart running timer with new delay
          await sound.update({ repeat: false }).catch(() => {});
          this.startTimedLoop(playlist, sound, seconds);
        }
        this.renderAll();
        return;
      }

      const target = ev.target.closest(".ss-row, .ss-pad");
      if (!target) return;

      const { playlist, sound } = this.getRowData(target);
      if (!playlist || !sound) return;

      this.showContextMenu(ev.clientX, ev.clientY, [
        {
          label: "▶ Jouer",
          action: async () => {
            await playlist.playSound(sound);
            this.renderAll();
          }
        },
        {
          label: "■ Arrêter",
          action: async () => {
            await playlist.stopSound(sound);
            this.stopTimedLoop(playlist, sound);
            this.renderAll();
          }
        },
        {
          label: "✏️ Renommer",
          action: () => this.renameSound(sound)
        },
        {
          label: "🗑️ Supprimer",
          danger: true,
          action: () => this.deleteSound(sound)
        }
      ]);
    });

    this.results.addEventListener("click", async ev => {
      const padLoop = ev.target.closest(".ss-pad-loop");
      if (padLoop) {
        ev.preventDefault();
        ev.stopPropagation();
        const target = padLoop.closest(".ss-pad");
        const { playlist, sound } = this.getRowData(target);
        if (playlist && sound) {
          const newRepeat = !sound.repeat;
          if (newRepeat) this.stopTimedLoop(playlist, sound);
          await sound.update({ repeat: newRepeat });
        }
        this.renderAll();
        return;
      }

      const padTimer = ev.target.closest(".ss-pad-timer");
      if (padTimer) {
        ev.preventDefault();
        ev.stopPropagation();
        const target = padTimer.closest(".ss-pad");
        const { playlist, sound } = this.getRowData(target);
        await this.toggleTimedLoop(playlist, sound);
        this.renderAll();
        return;
      }

      const pad = ev.target.closest(".ss-pad");
      if (pad) {
        if (ev.ctrlKey) {
          ev.preventDefault();
          this.toggleSoundSelection(pad);
          this.renderResults();
          return;
        }
        const { playlist, sound } = this.getRowData(pad);
        if (!playlist || !sound) return;
        await playlist.playSound(sound);
        this.renderAll();
        return;
      }

      const row = ev.target.closest(".ss-row");
      if (!row) return;

      if (ev.target.classList.contains("play")) {
        const { playlist, sound } = this.getRowData(row);
        if (playlist && sound) await playlist.playSound(sound);
        this.renderAll();
        return;
      }

      if (ev.target.classList.contains("stop")) {
        const { playlist, sound } = this.getRowData(row);
        if (playlist && sound) {
          await playlist.stopSound(sound);
          this.stopTimedLoop(playlist, sound);
        }
        this.renderAll();
        return;
      }

      if (ev.target.classList.contains("loop")) {
        const { playlist, sound } = this.getRowData(row);
        if (playlist && sound) {
          const newRepeat = !sound.repeat;
          if (newRepeat) this.stopTimedLoop(playlist, sound);
          await sound.update({ repeat: newRepeat });
        }
        this.renderAll();
        return;
      }

      if (ev.target.classList.contains("timer")) {
        const { playlist, sound } = this.getRowData(row);
        await this.toggleTimedLoop(playlist, sound);
        this.renderAll();
        return;
      }

      if (ev.ctrlKey) {
        this.toggleSoundSelection(row);
        this.renderResults();
        return;
      }

      if (ev.shiftKey && this.lastSelectedIndex >= 0) {
        this.selectRange(Number(row.dataset.index));
        this.renderResults();
        return;
      }

      const { playlist, sound } = this.getRowData(row);
      if (!playlist || !sound) return;
      await playlist.playSound(sound);
      this.renderAll();
    });

    this.results.addEventListener("dblclick", async ev => {
      if (ev.target.closest(".ss-pad-loop, .ss-pad-timer")) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      const pad = ev.target.closest(".ss-pad");
      if (pad) {
        const { playlist, sound } = this.getRowData(pad);
        if (!playlist || !sound) return;
        if (sound.playing) {
          await playlist.stopSound(sound);
          this.stopTimedLoop(playlist, sound);
          this.renderAll();
          return;
        }
        await playlist.playSound(sound);
        this.renderAll();
        return;
      }

      const row = ev.target.closest(".ss-row");
      if (!row) return;

      const { playlist, sound } = this.getRowData(row);
      if (!playlist || !sound) return;

      await playlist.playSound(sound);
      this.renderAll();
    });

    this.now.addEventListener("click", async ev => {
      const row = ev.target.closest(".ss-now-row");
      if (!row) return;

      const { playlist, sound } = this.getRowData(row);
      if (!playlist || !sound) return;

      if (ev.target.classList.contains("stop")) {
        await playlist.stopSound(sound).catch(() => {});
        this.stopTimedLoop(playlist, sound);
        this.renderAll();
        return;
      }
      if (ev.target.classList.contains("loop")) {
        const newRepeat = !sound.repeat;
        if (newRepeat) this.stopTimedLoop(playlist, sound);
        await sound.update({ repeat: newRepeat });
        this.renderAll();
        return;
      }
      if (ev.target.classList.contains("timer")) {
        await this.toggleTimedLoop(playlist, sound);
        this.renderAll();
        return;
      }
    });

    this.playingTitle.addEventListener("click", async ev => {
      const stopAllButton = ev.target.closest?.(".ss-stop-all");
      if (!stopAllButton) return;
      await this.stopAllSounds();
      this.renderAll();
    });

    this.now.addEventListener("input", async ev => {
      if (!ev.target.classList.contains("volume")) return;

      const row = ev.target.closest(".ss-now-row");
      const { sound } = this.getRowData(row);
      if (!sound) return;

      await sound.update({ volume: Number(ev.target.value) });
    });

    this.results.addEventListener("dragstart", ev => {
      const target = ev.target.closest(".ss-row, .ss-pad");
      if (!target) return;

      const key = `${target.dataset.playlist}:${target.dataset.sound}`;
      
      // Si le son dragué est sélectionné, on déplace tous les sélectionnés
      // Sinon, on déplace juste celui-ci
      const toMove = this.selectedSoundKeys.has(key) 
        ? Array.from(this.selectedSoundKeys)
        : [key];

      ev.dataTransfer.setData("application/json", JSON.stringify({
        sounds: toMove
      }));
    });

    // Allow reordering within the results list and show insertion indicator
    this.results.addEventListener("dragover", ev => {
      const row = ev.target.closest(".ss-row");
      if (!row) return;
      ev.preventDefault();
      const rect = row.getBoundingClientRect();
      const above = (ev.clientY - rect.top) < rect.height / 2;
      this.results.querySelectorAll(".drop-above, .drop-below").forEach(el => el.classList.remove("drop-above", "drop-below"));
      row.classList.add(above ? "drop-above" : "drop-below");
    });

    this.results.addEventListener("dragleave", ev => {
      const row = ev.target.closest(".ss-row");
      if (!row) return;
      row.classList.remove("drop-above", "drop-below");
    });

    this.results.addEventListener("drop", async ev => {
      ev.preventDefault();
      this.results.querySelectorAll(".drop-above, .drop-below").forEach(el => el.classList.remove("drop-above", "drop-below"));

      const payload = JSON.parse(ev.dataTransfer.getData("application/json") || "{}");
      const sounds = payload.sounds || [];
      if (!sounds.length) return;

      const targetRow = ev.target.closest(".ss-row");
      if (!targetRow) return;

      const targetPlaylistId = targetRow.dataset.playlist;
      const targetPlaylist = game.playlists.get(targetPlaylistId);
      if (!targetPlaylist) return;

      // If any sound belongs to the same playlist, perform reorder
      const movedIds = sounds.map(k => {
        const parts = k.split(":");
        return { playlistId: parts[0], soundId: parts[1] };
      });

      const samePlaylistIds = movedIds.filter(m => m.playlistId === targetPlaylistId).map(m => m.soundId);

      if (samePlaylistIds.length) {
        // reorder within playlist
        const entries = targetPlaylist.sounds.contents.map(s => s.id);

        // remove moved ids
        const remaining = entries.filter(id => !samePlaylistIds.includes(id));

        // determine insert index
        const insertIndex = Number(targetRow.dataset.index);
        const rect = targetRow.getBoundingClientRect();
        const above = (ev.clientY - rect.top) < rect.height / 2;
        const idx = above ? insertIndex : insertIndex + 1;

        // insert moved ids at idx
        remaining.splice(idx, 0, ...samePlaylistIds);

        const updates = remaining.map((id, i) => ({ _id: id, sort: i }));
        await targetPlaylist.updateEmbeddedDocuments("PlaylistSound", updates);

        this.selectedSoundKeys.clear();
        this.renderAll();
        return;
      }

      // Otherwise, treat as move to another playlist (create then delete)
      let moved = 0;
      for (const soundKey of sounds) {
        const [sourcePlaylistId, soundId] = soundKey.split(":");
        const sourcePlaylist = game.playlists.get(sourcePlaylistId);
        const targetPlaylist = game.playlists.get(targetPlaylistId);

        if (!sourcePlaylist || !targetPlaylist) continue;
        if (sourcePlaylist.id === targetPlaylist.id) continue;

        const sound = sourcePlaylist.sounds.get(soundId);
        if (!sound) continue;

        const data = sound.toObject();
        delete data._id;

        await targetPlaylist.createEmbeddedDocuments("PlaylistSound", [data]);
        await sourcePlaylist.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);
        const oldKey = `${sourcePlaylist.id}:${sound.id}`;
        this.stopTimedLoopByKey(oldKey);
        delete this.loopDelays[oldKey];
        this.saveLoopDelays();
        moved++;
      }

      this.selectedSoundKeys.clear();
      this.renderAll();
    });

    this.tree.addEventListener("dragover", ev => {
      const playlist = ev.target.closest(".ss-playlist[data-id]");
      if (!playlist || !playlist.dataset.id) return;

      ev.preventDefault();

      this.tree.querySelectorAll(".drag-target").forEach(el => el.classList.remove("drag-target"));
      playlist.classList.add("drag-target");
    });

    this.tree.addEventListener("dragleave", () => {
      this.tree.querySelectorAll(".drag-target").forEach(el => el.classList.remove("drag-target"));
    });

    this.tree.addEventListener("drop", async ev => {
      ev.preventDefault();

      this.tree.querySelectorAll(".drag-target").forEach(el => el.classList.remove("drag-target"));

      const targetEl = ev.target.closest(".ss-playlist[data-id]");
      if (!targetEl || !targetEl.dataset.id) return;

      const payload = JSON.parse(ev.dataTransfer.getData("application/json") || "{}");
      const sounds = payload.sounds || [];
      const targetPlaylistId = targetEl.dataset.id;

      let moved = 0;

      for (const soundKey of sounds) {
        const [sourcePlaylistId, soundId] = soundKey.split(":");
        const sourcePlaylist = game.playlists.get(sourcePlaylistId);
        const targetPlaylist = game.playlists.get(targetPlaylistId);

        if (!sourcePlaylist || !targetPlaylist) continue;
        if (sourcePlaylist.id === targetPlaylist.id) continue;

        const sound = sourcePlaylist.sounds.get(soundId);
        if (!sound) continue;

        const data = sound.toObject();
        delete data._id;

        await targetPlaylist.createEmbeddedDocuments("PlaylistSound", [data]);
        await sourcePlaylist.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);
        // cleanup timers/delays for moved sound
        const oldKey = `${sourcePlaylist.id}:${sound.id}`;
        this.stopTimedLoopByKey(oldKey);
        delete this.loopDelays[oldKey];
        this.saveLoopDelays();
        moved++;
      }

      // Vider la sélection après le déplacement
      this.selectedSoundKeys.clear();
      this.renderAll();
    });

    document.addEventListener("click", () => this.removeContextMenu());

    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape") {
        this.selectedSoundKeys.clear();
        this.renderResults();
      }
    });

    this.results.addEventListener("click", async ev => {
      if (ev.target.classList.contains("ss-move-to")) {
        await this.moveSelectedSounds();
        return;
      }
      if (ev.target.classList.contains("ss-copy-to")) {
        await this.copySelectedSounds();
        return;
      }
      if (ev.target.classList.contains("ss-delete-selected")) {
        await this.deleteSelectedSounds();
        return;
      }
      if (ev.target.classList.contains("ss-deselect-all")) {
        this.selectedSoundKeys.clear();
        this.renderResults();
        return;
      }
    });

    this.activateWindowDrag();
    this.activateResizeObserver();
  }

  async createPlaylist(soundboard = false) {
    const name = await this.promptText(
      soundboard ? "Créer un soundboard" : "Créer une playlist",
      "Nom",
      soundboard ? "Nouveau Soundboard" : "Nouvelle Playlist"
    );

    if (!name) return;

    await Playlist.create({
      name,
      mode: soundboard
        ? CONST.PLAYLIST_MODES.SIMULTANEOUS
        : CONST.PLAYLIST_MODES.SEQUENTIAL
    });

    this.renderAll();
  }

  async renamePlaylist(playlist) {
    const name = await this.promptText("Renommer la playlist", "Nom", playlist.name);
    if (!name || name === playlist.name) return;

    await playlist.update({ name });
    this.renderAll();
  }

  async renameSound(sound) {
    const name = await this.promptText("Renommer la piste", "Nom", sound.name);
    if (!name || name === sound.name) return;

    await sound.update({ name });
    this.renderAll();
  }

  async deletePlaylist(playlist) {
    const confirmed = await Dialog.confirm({
      title: "Supprimer la playlist",
      content: `<p>Supprimer <strong>${this.escape(playlist.name)}</strong> et toutes ses pistes ?</p>`
    });

    if (!confirmed) return;

    await playlist.delete();
    if (this.selectedPlaylistId === playlist.id) {
      this.selectedPlaylistId = null;
      this.saveSelectedPlaylistId();
    }
    this.renderAll();
  }

  async deleteSound(sound) {
    const confirmed = await Dialog.confirm({
      title: "Supprimer la piste",
      content: `<p>Supprimer <strong>${this.escape(sound.name)}</strong> ?</p>`
    });

    if (!confirmed) return;

    // clear any timers for this sound
    const playlist = game.playlists.contents.find(p => p.sounds.has(sound.id));
    if (playlist) {
      this.stopTimedLoop(playlist, sound);
      const key = `${playlist.id}:${sound.id}`;
      delete this.loopDelays[key];
      this.saveLoopDelays();
    }

    await sound.delete();
    this.renderAll();
  }

  async promptText(title, label, value = "") {
    return await Dialog.prompt({
      title,
      content: `
        <form>
          <div class="form-group">
            <label>${this.escape(label)}</label>
            <input type="text" name="value" value="${this.escape(value)}" autofocus />
          </div>
        </form>
      `,
      callback: html => html.find("input[name='value']").val()?.trim()
    });
  }

  showContextMenu(x, y, items) {
    this.removeContextMenu();

    const menu = document.createElement("div");
    menu.className = "ss-context-menu";

    menu.innerHTML = items.map((item, index) => `
      <button class="${item.danger ? "danger" : ""}" data-index="${index}">
        ${item.label}
      </button>
    `).join("");

    document.body.appendChild(menu);

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    menu.addEventListener("click", async ev => {
      const btn = ev.target.closest("button[data-index]");
      if (!btn) return;

      const item = items[Number(btn.dataset.index)];
      this.removeContextMenu();

      await item.action();
    });

    this.contextMenu = menu;
  }

  removeContextMenu() {
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  activateWindowDrag() {
    const header = this.win.querySelector(".ss-header");

    let dragging = false;
    let ox = 0;
    let oy = 0;

    header.addEventListener("mousedown", e => {
      if (e.target.closest("button")) return;

      dragging = true;
      ox = e.clientX - this.win.offsetLeft;
      oy = e.clientY - this.win.offsetTop;
    });

    document.addEventListener("mousemove", e => {
      if (!dragging) return;

      const left = e.clientX - ox;
      const top = e.clientY - oy;

      this.win.style.left = `${left}px`;
      this.win.style.top = `${top}px`;
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;

      dragging = false;
      this.savePosition();
    });
  }

  activateResizeObserver() {
    let timeout = null;

    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(timeout);

      timeout = setTimeout(() => {
        this.savePosition();
      }, 200);
    });

    this.resizeObserver.observe(this.win);
  }

  async stopAllSounds() {
    const playing = this.allEntries.filter(({ sound }) => sound.playing);

    for (const { playlist, sound } of playing) {
      try {
        await playlist.stopSound(sound);
        this.stopTimedLoop(playlist, sound);
      } catch {}
    }
    this.stopAllTimers();
  }

  getDefaultPlaylistId() {
    if (this.selectedPlaylistId) return this.selectedPlaylistId;
    const first = game.playlists.contents[0];
    return first ? first.id : null;
  }

  getCleanFileName(path) {
    try {
      const parts = String(path).split(/\//).filter(Boolean);
      let name = parts.length ? parts[parts.length - 1] : path;
      name = decodeURIComponent(name);
      name = name.replace(/\.[^.]+$/, "");
      name = name.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
      name = name.replace(/^\d+\s*-?\s*/, "");
      return name || "Nouveau Son";
    } catch {
      return "Nouveau Son";
    }
  }

  openOpus() {
    const existing = Object.values(ui.windows).find(app =>
      app?.title === "Opus" ||
      app?.constructor?.name === "OpusApp" ||
      app?.options?.template === "modules/dscryb/templates/opus-app.hbs"
    );

    if (existing) {
      existing.render?.(true);
      existing.bringToTop?.();
      existing.maximize?.();
      return;
    }

    const opusButton =
      document.querySelector('[title*="Opus"]') ||
      document.querySelector('[aria-label*="Opus"]') ||
      document.querySelector('[data-tooltip*="Opus"]');

    if (opusButton) {
      opusButton.click();
      return;
    }

    ui.notifications.warn("Opus n'est pas ouvert. Ouvre-le une première fois depuis dScryb / Origin Vault.");
  }

  openOriginVault() {
    const existing = Object.values(ui.windows ?? {}).find(w =>
      w?.title?.toLowerCase?.().includes("origin vault") ||
      w?.constructor?.name?.toLowerCase?.().includes("vault") ||
      w?.options?.classes?.some?.(c => String(c).toLowerCase().includes("origin"))
    );

    if (existing) {
      existing.render?.(true);
      existing.bringToTop?.();
      existing.maximize?.();
      this.originVaultApp = existing;
      return existing;
    }

    const vaultButton = document.querySelector('[title*="Origin Vault"], [aria-label*="Origin Vault"], [data-tooltip*="Origin Vault"], .fa-vault');
    if (vaultButton) {
      (vaultButton.closest?.("button, a, [role='button']") ?? vaultButton).click?.();
      return true;
    }

    ui.notifications?.warn("Ouvre Origin Vault une première fois.");
    return false;
  }

  getOriginVaultWindow() {
    const app = ui.activeWindow;
    if (
      app?.options?.id === "origin-vault-main" ||
      app?.constructor?.name === "MainWindow" ||
      app?.selectedItems !== undefined ||
      app?.allItems !== undefined
    ) {
      this.originVaultApp = app;
      return app;
    }

    return this.originVaultApp?.selectedItems !== undefined || this.originVaultApp?.allItems !== undefined
      ? this.originVaultApp
      : null;
  }

  getOriginVaultSelectedIds(selectedItems) {
    if (!selectedItems) return [];
    const getId = value => {
      if (value && typeof value === "object") return value.id ?? value._id ?? value.itemId;
      return value;
    };

    if (selectedItems instanceof Set) return Array.from(selectedItems).map(getId).filter(Boolean);
    if (Array.isArray(selectedItems)) return selectedItems.map(getId).filter(Boolean);
    if (typeof selectedItems === "object") {
      const values = Object.values(selectedItems);
      const valueIds = values.map(getId).filter(Boolean);
      if (valueIds.some(value => typeof value === "string" || typeof value === "number")) return valueIds;
      return Object.keys(selectedItems);
    }

    return [];
  }

  getOriginVaultSelectedAudioItems() {
    const ov = this.getOriginVaultWindow();
    console.debug("Origin Vault selectedItems", ov?.selectedItems);
    console.debug("Origin Vault allItems count", ov?.allItems?.length);

    const selectedIds = this.getOriginVaultSelectedIds(ov?.selectedItems).filter(Boolean);
    const allItems = Array.isArray(ov?.allItems) ? ov.allItems : [];
    if (!selectedIds.length || !allItems.length) return [];

    const selectedIdSet = new Set(selectedIds.map(id => String(id)));
    const audioPathPattern = /\.(mp3|ogg|wav|flac|m4a|webm)(\?|#|$)/i;

    return allItems
      .filter(item => selectedIdSet.has(String(item?.id)))
      .filter(item => audioPathPattern.test(String(item?.path ?? "")))
      .map(item => ({
        id: item.id,
        path: item.path,
        name: this.getCleanFileName(item.displayName || item.path)
      }));
  }

  async importSound() {
    const playlists = game.playlists.contents;
    if (!playlists.length) {
      ui.notifications?.error("Aucune playlist disponible pour l'import.");
      return;
    }

    const html = `
      <form>
        <div class="form-group">
          <label>Playlist cible</label>
          <select name="playlist">
            ${playlists.map(p => `<option value="${p.id}" ${this.selectedPlaylistId === p.id ? 'selected' : ''}>${this.escape(p.name)}</option>`).join("")}
          </select>
        </div>
      </form>
    `;

    const choice = await Dialog.prompt({
      title: "Importer un son",
      content: html,
      callback: el => el.find("select[name='playlist']").val()
    });

    if (!choice) return;
    const targetId = choice;

    try {
      new FilePicker({
        type: "audio",
        callback: async path => {
          try {
            const playlist = game.playlists.get(targetId);
            if (!playlist) throw new Error("Playlist introuvable");

            const name = this.getCleanFileName(path);

            await playlist.createEmbeddedDocuments("PlaylistSound", [{ name, path }]);
            ui.notifications?.info("Son importé avec succès.");
            this.renderAll();
          } catch (err) {
            ui.notifications?.error("Erreur lors de l'import du son.");
          }
        }
      }).render(true);
    } catch (err) {
      ui.notifications?.error("Impossible d'ouvrir le sélecteur de fichiers.");
    }
  }

  async importMultipleSounds() {
    if (!game.user.isGM) return;

    const playlists = game.playlists.contents;
    if (!playlists.length) {
      ui.notifications?.error("Aucune playlist disponible pour l'import.");
      return;
    }

    const html = `
      <form>
        <div class="form-group">
          <label>Playlist cible</label>
          <select name="playlist">
            ${playlists.map(p => `<option value="${p.id}" ${this.selectedPlaylistId === p.id ? 'selected' : ''}>${this.escape(p.name)}</option>`).join("")}
          </select>
        </div>
      </form>
    `;

    const targetId = await Dialog.prompt({
      title: "Importer plusieurs sons",
      content: html,
      callback: el => el.find("select[name='playlist']").val()
    });

    if (!targetId) return;

    const openedVault = this.openOriginVault();
    if (openedVault?.selectedItems !== undefined || openedVault?.allItems !== undefined) this.originVaultApp = openedVault;

    const cacheActiveVault = () => {
      const ov = this.getOriginVaultWindow();
      if (ov) this.originVaultApp = ov;
    };
    const trackVaultSelection = ev => {
      if (ev.target?.closest?.(".asset-card")) window.setTimeout(cacheActiveVault, 0);
    };
    document.addEventListener("click", trackVaultSelection, true);
    window.setTimeout(cacheActiveVault, 0);

    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        document.removeEventListener("click", trackVaultSelection, true);
        resolve(value);
      };

      new Dialog({
        title: "Sound System",
        content: "<p>Sélectionne tes sons dans Origin Vault, puis clique Importer la sélection.</p>",
        buttons: {
          import: {
            label: "Importer la sélection",
            callback: async () => {
              try {
                const playlist = game.playlists.get(targetId);
                if (!playlist) throw new Error("Playlist introuvable");

                const items = this.getOriginVaultSelectedAudioItems();
                if (!items.length) {
                  ui.notifications?.warn("Aucun son audio sélectionné dans Origin Vault.");
                  finish(false);
                  return;
                }

                await playlist.createEmbeddedDocuments("PlaylistSound", items.map(item => ({
                  name: item.name,
                  path: item.path
                })));

                ui.notifications?.info(`${items.length} sons importés depuis Origin Vault.`);
                this.renderAll();
                finish(true);
              } catch (err) {
                console.error("sound_system | Erreur import Origin Vault", err);
                ui.notifications?.error("Erreur lors de l'import depuis Origin Vault.");
                finish(false);
              }
            }
          },
          cancel: {
            label: "Annuler",
            callback: () => finish(false)
          }
        },
        default: "import",
        close: () => finish(false)
      }).render(true);
    });

  }

  getDirectoryFromPath(path) {
    const cleanPath = String(path ?? "").split(/[?#]/)[0];
    if (!cleanPath) return "";

    const fileName = cleanPath.split("/").pop() ?? "";
    const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
    if (!SOUND_SYSTEM_AUDIO_EXTENSIONS.has(extension)) return cleanPath;

    const index = cleanPath.lastIndexOf("/");
    return index >= 0 ? cleanPath.slice(0, index) : "";
  }

  async getAudioFilesFromDirectory(source, target) {
    if (!FilePicker?.browse) throw new Error("FilePicker.browse indisponible");

    const result = await FilePicker.browse(source || "data", target || "");
    const files = Array.isArray(result?.files) ? result.files : [];
    const audioFiles = files
      .map(file => String(file))
      .filter(file => {
        const cleanPath = file.split(/[?#]/)[0];
        const fileName = cleanPath.split("/").pop() ?? "";
        const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
        return SOUND_SYSTEM_AUDIO_EXTENSIONS.has(extension);
      });

    return Array.from(new Set(audioFiles)).sort((a, b) => a.localeCompare(b));
  }

  async promptMultipleAudioFiles(files, directory) {
    const items = files.map((file, index) => {
      const name = this.getCleanFileName(file);
      return `
        <label class="ss-multi-import-file">
          <input type="checkbox" name="file" value="${index}" checked />
          <span>${this.escape(name)}</span>
        </label>
      `;
    }).join("");

    const content = `
      <form class="ss-multi-import">
        <p class="notes">Dossier: ${this.escape(directory || "/")}</p>
        <div class="ss-multi-import-actions">
          <button type="button" data-action="select-all">Tout sÃ©lectionner</button>
          <button type="button" data-action="select-none">Tout dÃ©sÃ©lectionner</button>
        </div>
        <div class="ss-multi-import-list">
          ${items}
        </div>
      </form>
    `;

    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      new Dialog({
        title: "SÃ©lectionner les sons Ã  importer",
        content,
        buttons: {
          import: {
            label: "Importer",
            callback: html => {
              const indexes = html.find("input[name='file']:checked").map((_, input) => Number(input.value)).get();
              finish(indexes.map(index => files[index]).filter(Boolean));
            }
          },
          cancel: {
            label: "Annuler",
            callback: () => finish(null)
          }
        },
        default: "import",
        render: html => {
          html.find("[data-action='select-all']").on("click", () => {
            html.find("input[name='file']").prop("checked", true);
          });
          html.find("[data-action='select-none']").on("click", () => {
            html.find("input[name='file']").prop("checked", false);
          });
        },
        close: () => finish(null)
      }).render(true);
    });
  }

  toggleSoundSelection(element) {
    const key = `${element.dataset.playlist}:${element.dataset.sound}`;
    if (this.selectedSoundKeys.has(key)) {
      this.selectedSoundKeys.delete(key);
    } else {
      this.selectedSoundKeys.add(key);
    }
    this.lastSelectedIndex = Number(element.dataset.index);
  }

  selectRange(toIndex) {
    const fromIndex = this.lastSelectedIndex;
    const entries = this.getFilteredEntries();
    const minIndex = Math.min(fromIndex, toIndex);
    const maxIndex = Math.max(fromIndex, toIndex);

    for (let i = minIndex; i <= maxIndex && i < entries.length; i++) {
      const { playlist, sound } = entries[i];
      const key = `${playlist.id}:${sound.id}`;
      this.selectedSoundKeys.add(key);
    }

    this.lastSelectedIndex = toIndex;
  }

  async moveSelectedSounds() {
    const playlists = game.playlists.contents;
    if (!playlists.length) return;

    const html = `
      <form>
        <div class="form-group">
          <label>Playlist cible</label>
          <select name="playlist">
            ${playlists.map(p => `<option value="${p.id}">${this.escape(p.name)}</option>`).join("")}
          </select>
        </div>
      </form>
    `;

    const targetId = await Dialog.prompt({
      title: "Déplacer les sons",
      content: html,
      callback: el => el.find("select[name='playlist']").val()
    });

    if (!targetId) return;

    const targetPlaylist = game.playlists.get(targetId);
    if (!targetPlaylist) return;

    let count = 0;
    for (const key of this.selectedSoundKeys) {
      const [playlistId, soundId] = key.split(":");
      const sourcePlaylist = game.playlists.get(playlistId);
      if (!sourcePlaylist) continue;

      const sound = sourcePlaylist.sounds.get(soundId);
      if (!sound) continue;

      const data = sound.toObject();
      delete data._id;

      await targetPlaylist.createEmbeddedDocuments("PlaylistSound", [data]);
      await sourcePlaylist.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);
      // cleanup timers/delays from source
      const oldKey = `${sourcePlaylist.id}:${sound.id}`;
      this.stopTimedLoopByKey(oldKey);
      delete this.loopDelays[oldKey];
      this.saveLoopDelays();
      count++;
    }

    this.selectedSoundKeys.clear();
    ui.notifications?.info(`${count} son${count > 1 ? "s" : ""} déplacé${count > 1 ? "s" : ""}`);
    this.renderAll();
  }

  async copySelectedSounds() {
    const playlists = game.playlists.contents;
    if (!playlists.length) return;

    const html = `
      <form>
        <div class="form-group">
          <label>Playlist cible</label>
          <select name="playlist">
            ${playlists.map(p => `<option value="${p.id}">${this.escape(p.name)}</option>`).join("")}
          </select>
        </div>
      </form>
    `;

    const targetId = await Dialog.prompt({
      title: "Copier les sons",
      content: html,
      callback: el => el.find("select[name='playlist']").val()
    });

    if (!targetId) return;

    const targetPlaylist = game.playlists.get(targetId);
    if (!targetPlaylist) return;

    let count = 0;
    for (const key of this.selectedSoundKeys) {
      const [playlistId, soundId] = key.split(":");
      const sourcePlaylist = game.playlists.get(playlistId);
      if (!sourcePlaylist) continue;

      const sound = sourcePlaylist.sounds.get(soundId);
      if (!sound) continue;

      const data = sound.toObject();
      delete data._id;

      await targetPlaylist.createEmbeddedDocuments("PlaylistSound", [data]);
      count++;
    }

    this.selectedSoundKeys.clear();
    ui.notifications?.info(`${count} son${count > 1 ? "s" : ""} copié${count > 1 ? "s" : ""}`);
    this.renderAll();
  }

  async deleteSelectedSounds() {
    const count = this.selectedSoundKeys.size;
    const confirmed = await Dialog.confirm({
      title: "Supprimer les sons",
      content: `<p>Supprimer <strong>${count} son${count > 1 ? "s" : ""}</strong> ?</p>`
    });

    if (!confirmed) return;

    for (const key of this.selectedSoundKeys) {
      const [playlistId, soundId] = key.split(":");
      const playlist = game.playlists.get(playlistId);
      if (!playlist) continue;

      const sound = playlist.sounds.get(soundId);
      if (!sound) continue;

      await playlist.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);
      // cleanup timers/delays
      this.stopTimedLoop(playlist, sound);
      const lk = `${playlist.id}:${sound.id}`;
      delete this.loopDelays[lk];
      this.saveLoopDelays();
    }

    this.selectedSoundKeys.clear();
    ui.notifications?.info(`${count} son${count > 1 ? "s" : ""} supprimé${count > 1 ? "s" : ""}`);
    this.renderAll();
  }

  getRowData(row) {
    const playlist = game.playlists.get(row.dataset.playlist);
    const sound = playlist?.sounds.get(row.dataset.sound);
    return { playlist, sound };
  }

  escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

Hooks.once("init", () => {
  console.log("sound_system: init hook");
  game.settings.register(SOUND_SYSTEM_MODULE_ID, SOUND_SYSTEM_PRESETS_SETTING, {
    name: "Sound System Presets",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
});

Hooks.once("ready", () => {
  console.log("sound_system: ready hook");
  if (!game.user.isGM) {
    console.log("sound_system: not GM, launcher disabled");
    return;
  }

  function addLauncher() {
    try {
      if (!game.user.isGM) {
        console.log("sound_system: addLauncher skipped, not GM");
        return;
      }
      document.getElementById("sound-system-launcher")?.remove();

      const button = document.createElement("button");
      button.id = "sound-system-launcher";
      button.innerHTML = "🎵";
      button.title = "Sound System";
      button.style.position = "fixed";
      button.style.right = "18px";
      button.style.bottom = "220px";
      button.style.zIndex = 60;
      button.addEventListener("click", () => {
        console.log("sound_system: launcher clicked");
        SoundSystem.open();
      });

      document.body.appendChild(button);
      console.log("sound_system: launcher appended");
    } catch (err) {
      console.error("sound_system: addLauncher error", err);
    }
  }

  addLauncher();

  Hooks.on("renderApplication", () => addLauncher());

  game.soundSystem = {
    open: () => SoundSystem.open()
  };

  Hooks.on("updatePlaylist", () => SoundSystem.instance?.renderAll());
  Hooks.on("updatePlaylistSound", () => SoundSystem.instance?.renderAll());
  Hooks.on("createPlaylistSound", () => SoundSystem.instance?.renderAll());
  Hooks.on("deletePlaylistSound", sound => {
    SoundSystem.cleanupDeletedSoundTimer(sound);
    SoundSystem.instance?.renderAll();
  });
});
