(() => {
  "use strict";

  /* ============================================================
     CONFIGURATION
     ------------------------------------------------------------
     Sur GitHub Pages (https://utilisateur.github.io/depot/),
     le dépôt est détecté automatiquement.
     En local, renseignez owner et repo pour utiliser l'API,
     ou gardez lists/index.json comme solution de secours.
     ============================================================ */
  const CONFIG = {
    owner: "",          // ex : "monpseudo"
    repo: "",           // ex : "devine-expression"
    branch: "",         // vide = branche par défaut du dépôt
    listsDir: "lists",
  };

  /* ---------- Utilitaires ---------- */
  const $ = (id) => document.getElementById(id);

  const el = {
    listSelect: $("list-select"),
    listInfo: $("list-info"),
    duration: $("duration"),
    maxSkips: $("max-skips"),
    unlimited: $("unlimited-skips"),
    setupError: $("setup-error"),
    timer: $("timer"),
    skips: $("skips"),
    score: $("score"),
    expression: $("expression"),
    btnFound: $("btn-found"),
    btnSkip: $("btn-skip"),
    btnPause: $("btn-pause"),
    btnQuit: $("btn-quit"),
    pauseOverlay: $("pause-overlay"),
    finalScore: $("final-score"),
    finalSkips: $("final-skips"),
    modal: $("confirm-modal"),
  };

  const state = {
    lists: [],            // [{ file, name }]
    words: [],            // expressions mélangées
    index: 0,
    score: 0,
    skipsUsed: 0,
    timeLeft: 0,
    interval: null,
    paused: false,
    settings: { lists: [], duration: 60, maxSkips: 3, unlimited: false },
  };

  const STORAGE_KEY = "devine-expression-settings";

  function show(screenId) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(screenId).classList.add("active");
  }

  function shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // "A1-B2.txt" -> "A1-B2" ; "films_cultes.txt" -> "films cultes"
  function prettifyName(file) {
    const base = file.replace(/\.txt$/i, "").replace(/_+/g, " ").trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  /* ---------- Détection du dépôt GitHub ---------- */
  function detectRepo() {
    if (CONFIG.owner && CONFIG.repo) {
      return { owner: CONFIG.owner, repo: CONFIG.repo };
    }
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.split(".")[0];
      const repo = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
      return { owner, repo };
    }
    return null;
  }

  /* ---------- Chargement des listes ---------- */
  async function loadListsFromApi() {
    const info = detectRepo();
    if (!info) throw new Error("Dépôt GitHub non détecté");

    let url = `https://api.github.com/repos/${info.owner}/${info.repo}/contents/${CONFIG.listsDir}`;
    if (CONFIG.branch) url += `?ref=${encodeURIComponent(CONFIG.branch)}`;

    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`API GitHub : ${res.status}`);

    const items = await res.json();
    return items
      .filter((i) => i.type === "file" && /\.txt$/i.test(i.name))
      .sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }))
      .map((i) => ({ file: i.name, name: prettifyName(i.name) }));
  }

  async function loadListsFromIndex() {
    const res = await fetch(`${CONFIG.listsDir}/index.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error("index.json introuvable");
    const data = await res.json();
    return data.map((e) =>
      typeof e === "string"
        ? { file: e, name: prettifyName(e) }
        : { file: e.file, name: e.name || prettifyName(e.file) }
    );
  }

  async function loadLists() {
    try {
      const lists = await loadListsFromApi();
      if (lists.length) return lists;
      throw new Error("Aucun fichier .txt trouvé via l'API");
    } catch (err) {
      console.warn("API GitHub indisponible, essai avec index.json :", err.message);
      return loadListsFromIndex();
    }
  }

  async function loadWords(file) {
    const res = await fetch(`${CONFIG.listsDir}/${encodeURIComponent(file)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Impossible de charger ${file}`);
    const text = await res.text();
    const words = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return [...new Set(words)]; // supprime les doublons
  }

  // Charge et fusionne plusieurs listes (sans doublons)
  async function loadWordsFromFiles(files) {
    const results = await Promise.all(files.map(loadWords));
    return [...new Set(results.flat())];
  }

  /* ---------- Réglages ---------- */
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (_) { /* stockage indisponible */ }
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        // Compatibilité avec l'ancien réglage à liste unique
        if (!Array.isArray(saved.lists)) {
          saved.lists = saved.list ? [saved.list] : [];
        }
        delete saved.list;
        Object.assign(state.settings, saved);
      }
    } catch (_) { /* ignore */ }
  }

  function getSelectedLists() {
    return Array.from(el.listSelect.querySelectorAll('input[type="checkbox"]:checked'))
      .map((cb) => cb.value);
  }

  function readSettingsFromForm() {
    const duration = Math.max(10, Math.min(600, parseInt(el.duration.value, 10) || 60));
    const maxSkips = Math.max(0, Math.min(99, parseInt(el.maxSkips.value, 10) || 0));
    state.settings = {
      lists: getSelectedLists(),
      duration,
      maxSkips,
      unlimited: el.unlimited.checked,
    };
    saveSettings();
  }

  function applySettingsToForm() {
    el.duration.value = state.settings.duration;
    el.maxSkips.value = state.settings.maxSkips;
    el.unlimited.checked = state.settings.unlimited;
    el.maxSkips.disabled = state.settings.unlimited;
  }

  async function updateListInfo() {
    const files = getSelectedLists();
    if (!files.length) { el.listInfo.textContent = "Sélectionnez au moins une liste."; return; }
    try {
      const words = await loadWordsFromFiles(files);
      // Évite d'afficher un résultat périmé si la sélection a changé entre-temps
      if (getSelectedLists().join("|") !== files.join("|")) return;
      el.listInfo.textContent =
        `${words.length} expression(s) dans ${files.length} liste(s) sélectionnée(s)`;
    } catch (_) {
      el.listInfo.textContent = "";
    }
  }

  /* ---------- Partie ---------- */
  async function startGame() {
    el.setupError.textContent = "";
    readSettingsFromForm();

    if (!state.lists.length) {
      el.setupError.textContent = "Aucune liste disponible.";
      return;
    }
    if (!state.settings.lists.length) {
      el.setupError.textContent = "Sélectionnez au moins une liste.";
      return;
    }

    try {
      const words = await loadWordsFromFiles(state.settings.lists);
      if (!words.length) {
        el.setupError.textContent = "Les listes sélectionnées sont vides.";
        return;
      }
      state.words = shuffle(words);
      state.index = 0;
      show("screen-ready");
    } catch (err) {
      el.setupError.textContent = err.message;
    }
  }

  function currentWord() {
    return state.words[state.index];
  }

  function nextWord() {
    state.index++;
    if (state.index >= state.words.length) {
      // Toute la liste a été parcourue : on remélange
      state.words = shuffle(state.words);
      state.index = 0;
    }
    el.expression.textContent = currentWord();
  }

  function skipsRemaining() {
    return state.settings.unlimited
      ? Infinity
      : Math.max(0, state.settings.maxSkips - state.skipsUsed);
  }

  function updateHud() {
    el.timer.textContent = state.timeLeft;
    el.timer.classList.toggle("warning", state.timeLeft <= 10);
    el.score.textContent = `✔ ${state.score}`;

    if (state.settings.unlimited) {
      el.skips.textContent = "Passes : ∞";
      el.btnSkip.disabled = false;
    } else {
      const left = skipsRemaining();
      el.skips.textContent = `Passes : ${left}`;
      el.btnSkip.disabled = left <= 0;
    }
  }

  function startRound() {
    state.score = 0;
    state.skipsUsed = 0;
    state.timeLeft = state.settings.duration;
    state.paused = false;

    el.pauseOverlay.classList.add("hidden");
    el.btnPause.textContent = "⏸";
    el.expression.textContent = currentWord();
    updateHud();
    show("screen-game");

    clearInterval(state.interval);
    state.interval = setInterval(tick, 1000);
  }

  function tick() {
    if (state.paused) return;
    state.timeLeft--;
    updateHud();
    if (state.timeLeft <= 0) endRound();
  }

  function found() {
    if (state.paused) return;
    state.score++;
    nextWord();
    updateHud();
  }

  function skip() {
    if (state.paused) return;
    if (skipsRemaining() <= 0) return;
    state.skipsUsed++;
    nextWord();
    updateHud();
  }

  function togglePause() {
    state.paused = !state.paused;
    el.pauseOverlay.classList.toggle("hidden", !state.paused);
    el.btnPause.textContent = state.paused ? "▶" : "⏸";
  }

  function endRound() {
    clearInterval(state.interval);
    state.interval = null;
    state.index++; // le mot affiché à la fin ne sera pas rejoué immédiatement
    if (state.index >= state.words.length) {
      state.words = shuffle(state.words);
      state.index = 0;
    }

    el.finalScore.textContent = state.score;
    el.finalSkips.textContent = state.settings.unlimited
      ? `${state.skipsUsed} passe(s) utilisée(s)`
      : `${state.skipsUsed} / ${state.settings.maxSkips} passe(s) utilisée(s)`;
    show("screen-end");

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  /* ---------- Quitter la partie ---------- */
  let wasPausedBeforeConfirm = false;

  function askQuit() {
    wasPausedBeforeConfirm = state.paused;
    if (!state.paused) togglePause();
    el.modal.classList.remove("hidden");
    $("confirm-no").focus();
  }

  function closeConfirm() {
    el.modal.classList.add("hidden");
  }

  function cancelQuit() {
    closeConfirm();
    if (!wasPausedBeforeConfirm && state.paused) togglePause();
  }

  function confirmQuit() {
    closeConfirm();
    clearInterval(state.interval);
    state.interval = null;
    state.paused = false;
    show("screen-setup");
  }

  /* ---------- Initialisation ---------- */
  async function init() {
    restoreSettings();
    applySettingsToForm();

    try {
      state.lists = await loadLists();
    } catch (err) {
      el.setupError.textContent =
        "Impossible de charger les listes. Vérifiez le dossier « lists » (ou renseignez owner/repo dans CONFIG).";
      console.error(err);
      return;
    }

    // Sélection initiale : réglages enregistrés, sinon première liste
    let selected = state.settings.lists.filter((f) => state.lists.some((l) => l.file === f));
    if (!selected.length && state.lists.length) selected = [state.lists[0].file];

    el.listSelect.innerHTML = "";
    state.lists.forEach((l) => {
      const label = document.createElement("label");
      label.className = "checkbox";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = l.file;
      cb.checked = selected.includes(l.file);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(l.name));
      el.listSelect.appendChild(label);
    });
    updateListInfo();
  }

  /* ---------- Événements ---------- */
  el.listSelect.addEventListener("change", updateListInfo);
  el.unlimited.addEventListener("change", () => {
    el.maxSkips.disabled = el.unlimited.checked;
  });

  $("btn-start").addEventListener("click", startGame);
  $("btn-go").addEventListener("click", startRound);
  el.btnFound.addEventListener("click", found);
  el.btnSkip.addEventListener("click", skip);
  el.btnPause.addEventListener("click", togglePause);
  el.btnQuit.addEventListener("click", askQuit);
  $("btn-next-turn").addEventListener("click", () => show("screen-ready"));

  $("confirm-no").addEventListener("click", cancelQuit);
  $("confirm-yes").addEventListener("click", confirmQuit);
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) cancelQuit(); // clic en dehors de la boîte
  });

  document.querySelectorAll('[data-action="to-setup"]').forEach((b) =>
    b.addEventListener("click", () => {
      clearInterval(state.interval);
      state.interval = null;
      show("screen-setup");
    })
  );

  // Raccourcis clavier (ordinateur)
  document.addEventListener("keydown", (e) => {
    const modalOpen = !el.modal.classList.contains("hidden");

    if (modalOpen) {
      if (e.code === "Escape") cancelQuit();
      return; // pas de raccourcis de jeu pendant la confirmation
    }

    if (!$("screen-game").classList.contains("active")) return;
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); found(); }
    if (e.code === "ArrowRight") skip();
    if (e.code === "KeyP") togglePause();
    if (e.code === "Escape") askQuit();
  });

  init();
})();
