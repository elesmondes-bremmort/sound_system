const SOUND_SYSTEM_ID = "sound-system";

class SoundSystem {
  static instance = null;

  static open() {
    if (this.instance) {
      this.instance.close();
      return;
    }

    this.instance = new SoundSystem();
    this.instance.render();
  }

  constructor() {
    this.selectedPlaylistId = null;
    this.position = { top: 80, left: 100, width: 980, height: 680 };
  }

  get allEntries() {
    return game.playlists.contents.flatMap(playlist =>
      playlist.sounds.contents.map(sound => ({ playlist, sound }))
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

    this.activateListeners();
    this.renderAll();
    this.search.focus();
  }

  close() {
    document.getElementById(SOUND_SYSTEM_ID)?.remove();
    this.removeContextMenu();
    SoundSystem.instance = null;
  }

  renderAll() {
    this.renderTree();
    this.renderResults();
    this.renderNowPlaying();
  }

  renderTree() {
    this.tree.innerHTML = `
      <div class="ss-tree-actions">
        <button class="ss-create-playlist">+ Playlist</button>
        <button class="ss-create-soundboard">+ Soundboard</button>
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

  renderResults() {
    const entries = this.getFilteredEntries();

    this.results.innerHTML = entries.length
      ? entries.map(({ playlist, sound }) => `
        <div class="ss-row" draggable="true" data-playlist="${playlist.id}" data-sound="${sound.id}">
          <button class="ss-btn play" title="Jouer">▶</button>
          <button class="ss-btn stop" title="Arrêter">■</button>
          <button class="ss-btn loop" title="Boucle">${sound.repeat ? "🔁" : "↻"}</button>

          <div class="ss-name">
            ${sound.playing ? "🟢 " : ""}${this.escape(sound.name)}
            <div class="ss-sub">${this.escape(playlist.name)}</div>
          </div>
        </div>
      `).join("")
      : `<p class="ss-empty">Aucun son trouvé.</p>`;
  }

  renderNowPlaying() {
    const playing = this.allEntries.filter(({ sound }) => sound.playing);

    this.playingTitle.innerHTML = `<b>En cours (${playing.length})</b>`;

    this.now.innerHTML = playing.length
      ? playing.map(({ playlist, sound }) => `
        <div class="ss-now-row" data-playlist="${playlist.id}" data-sound="${sound.id}">
          <button class="ss-btn stop" title="Arrêter">■</button>

          <div>
            <div class="ss-name">${this.escape(sound.name)}</div>
            <div class="ss-sub">${this.escape(playlist.name)}</div>
            <input class="volume" type="range" min="0" max="1" step="0.05" value="${sound.volume ?? 0.5}" />
          </div>
        </div>
      `).join("")
      : `<p class="ss-empty">Aucune piste en cours.</p>`;
  }

  activateListeners() {
    this.win.querySelector(".ss-close").addEventListener("click", () => this.close());

    this.tree.addEventListener("click", async ev => {
      if (ev.target.classList.contains("ss-create-playlist")) {
        await this.createPlaylist(false);
        return;
      }

      if (ev.target.classList.contains("ss-create-soundboard")) {
        await this.createPlaylist(true);
        return;
      }

      const item = ev.target.closest(".ss-playlist");
      if (!item) return;

      this.selectedPlaylistId = item.dataset.id || null;
      this.renderAll();
    });

    this.tree.addEventListener("contextmenu", ev => {
      ev.preventDefault();

      const item = ev.target.closest(".ss-playlist");
      const playlist = item?.dataset.id ? game.playlists.get(item.dataset.id) : null;

      this.showContextMenu(ev.clientX, ev.clientY, [
        {
          label: "➕ Nouvelle playlist",
          action: () => this.createPlaylist(false)
        },
        {
          label: "🎛️ Nouveau soundboard",
          action: () => this.createPlaylist(true)
        },
        playlist && {
          label: "✏️ Renommer",
          action: () => this.renamePlaylist(playlist)
        },
        playlist && {
          label: "🗑️ Supprimer",
          danger: true,
          action: () => this.deletePlaylist(playlist)
        }
      ].filter(Boolean));
    });

    this.search.addEventListener("input", () => this.renderResults());

    this.results.addEventListener("contextmenu", ev => {
      ev.preventDefault();

      const row = ev.target.closest(".ss-row");
      if (!row) return;

      const { playlist, sound } = this.getRowData(row);
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
      const row = ev.target.closest(".ss-row");
      if (!row) return;

      const { playlist, sound } = this.getRowData(row);
      if (!playlist || !sound) return;

      if (ev.target.classList.contains("play")) await playlist.playSound(sound);
      if (ev.target.classList.contains("stop")) await playlist.stopSound(sound);
      if (ev.target.classList.contains("loop")) await sound.update({ repeat: !sound.repeat });

      this.renderAll();
    });

    this.results.addEventListener("dblclick", async ev => {
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
        await playlist.stopSound(sound);
        this.renderAll();
      }
    });

    this.now.addEventListener("input", async ev => {
      if (!ev.target.classList.contains("volume")) return;

      const row = ev.target.closest(".ss-now-row");
      const { sound } = this.getRowData(row);
      if (!sound) return;

      await sound.update({ volume: Number(ev.target.value) });
    });

    this.results.addEventListener("dragstart", ev => {
      const row = ev.target.closest(".ss-row");
      if (!row) return;

      ev.dataTransfer.setData("application/json", JSON.stringify({
        playlistId: row.dataset.playlist,
        soundId: row.dataset.sound
      }));
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

      const sourcePlaylist = game.playlists.get(payload.playlistId);
      const targetPlaylist = game.playlists.get(targetEl.dataset.id);

      if (!sourcePlaylist || !targetPlaylist) return;
      if (sourcePlaylist.id === targetPlaylist.id) return;

      const sound = sourcePlaylist.sounds.get(payload.soundId);
      if (!sound) return;

      const data = sound.toObject();
      delete data._id;

      await targetPlaylist.createEmbeddedDocuments("PlaylistSound", [data]);
      await sourcePlaylist.deleteEmbeddedDocuments("PlaylistSound", [sound.id]);

      this.renderAll();
    });

    document.addEventListener("click", () => this.removeContextMenu());

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
    if (this.selectedPlaylistId === playlist.id) this.selectedPlaylistId = null;
    this.renderAll();
  }

  async deleteSound(sound) {
    const confirmed = await Dialog.confirm({
      title: "Supprimer la piste",
      content: `<p>Supprimer <strong>${this.escape(sound.name)}</strong> ?</p>`
    });

    if (!confirmed) return;

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

      this.position.left = left;
      this.position.top = top;
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  activateResizeObserver() {
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      this.position.width = rect.width;
      this.position.height = rect.height;
    });

    observer.observe(this.win);
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

Hooks.once("ready", () => {
  document.getElementById("sound-system-launcher")?.remove();

  const button = document.createElement("button");
  button.id = "sound-system-launcher";
  button.innerHTML = "🎵";
  button.title = "Sound System";
  button.addEventListener("click", () => SoundSystem.open());

  document.body.appendChild(button);

  game.soundSystem = {
    open: () => SoundSystem.open()
  };

  Hooks.on("updatePlaylist", () => SoundSystem.instance?.renderAll());
  Hooks.on("updatePlaylistSound", () => SoundSystem.instance?.renderAll());
  Hooks.on("createPlaylistSound", () => SoundSystem.instance?.renderAll());
  Hooks.on("deletePlaylistSound", () => SoundSystem.instance?.renderAll());
});