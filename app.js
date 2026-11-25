(() => {
  "use strict";

  /* ---------- Configuration du dépôt ---------- */
  const CONFIG = {
    // Laisser vide pour la détection automatique sur GitHub Pages
    // (https://utilisateur.github.io/depot/). À renseigner pour un domaine
    // personnalisé ou pour tester en local avec l'API.
    owner: "",
    repo: "",
    branch: "",          // vide = branche par défaut du dépôt
    folder: "lists",
    cacheMinutes: 10,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    listSelect: $("list-select"),
    listInfo: $("list-info"),
    duration: $("duration"),
    maxSkips: $("max-skips"),
    unlimited: $("unlimited-skips"),
    setupError: $("setup-error"),
    timer: $("timer"),
    score: $("score"),
    skips: $("skips"),
    word: $("word"),
    btnSkip: $("btn-skip"),
    btnFound: $("btn-found"),
    btnPause: $("btn-pause"),
    endScore: $("end-score"),
  };

  const state = {
    catalog: [],
    words: [],        // liste mélangée
    index: 0,
    score: 0,
    skipsLeft: 0,
    timeLeft: 0,
    interval: null,
    paused: false,
    settings: { list: "", duration: 60, maxSkips: 3, unlimited: false },
  };

  /* ---------- Utilitaires ---------- */
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    $(id).classList.add("active");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function parseList(text) {
    const seen = new Set();
    return text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => {
        if (!l || seen.has(l.toLowerCase())) return false;
        seen.add(l.toLowerCase());
        return true;
      });
  }

  /* ---------- Catalogue des listes (API GitHub) ---------- */
  function detectRepo() {
    if (CONFIG.owner && CONFIG.repo) return { owner: CONFIG.owner, repo: CONFIG.repo };
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (!m) return null;
    const repo = location.pathname.split("/").filter(Boolean)[0] || `${m[1]}.github.io`;
    return { owner: m[1], repo };
  }

  function prettifyName(file) {
    const base = file.replace(/\.txt$/i, "").replace(/[_-]+/g, " ").trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  async function loadCatalog() {
    const CACHE_KEY = "taboo-catalog";
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch {}

    // 1. Cache encore valide
    if (cached && Date.now() - cached.time < CONFIG.cacheMinutes * 60000) {
      return cached.data;
    }

    // 2. API GitHub
    const repo = detectRepo();
    if (repo) {
      try {
        let url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${CONFIG.folder}`;
        if (CONFIG.branch) url += `?ref=${encodeURIComponent(CONFIG.branch)}`;
        const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`API GitHub : ${res.status}`);
        const items = await res.json();
        const data = items
          .filter((i) => i.type === "file" && /\.txt$/i.test(i.name))
          .map((i) => ({ file: i.name, name: prettifyName(i.name) }))
          .sort((a, b) => a.name.localeCompare(b.name, "fr"));
        if (data.length) {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data }));
          return data;
        }
      } catch (e) {
        console.warn("API GitHub indisponible, repli sur index.json :", e.message);
      }
    }

    // 3. Repli : lists/index.json (optionnel)
    try {
      const res = await fetch(`${CONFIG.folder}/index.json`, { cache: "no-cache" });
      if (res.ok) return await res.json();
    } catch {}

    // 4. Dernier recours : cache périmé
    if (cached) return cached.data;

    throw new Error("Impossible de charger la liste des fichiers.");
  }

  /* ---------- Réglages mémorisés ---------- */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem("taboo-settings"));
      if (s) Object.assign(state.settings, s);
    } catch {}
    el.duration.value = state.settings.duration;
    el.maxSkips.value = state.settings.maxSkips;
    el.unlimited.checked = state.settings.unlimited;
    el.maxSkips.disabled = state.settings.unlimited;
  }

  function saveSettings() {
    state.settings = {
      list: el.listSelect.value,
      duration: Math.max(10, parseInt(el.duration.value, 10) || 60),
      maxSkips: Math.max(0, parseInt(el.maxSkips.value, 10) || 0),
      unlimited: el.unlimited.checked,
    };
    localStorage.setItem("taboo-settings", JSON.stringify(state.settings));
  }

  /* ---------- Chargement d'une liste ---------- */
  async function fetchWords(file) {
    const res = await fetch(`${CONFIG.folder}/${encodeURIComponent(file)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Impossible de lire ${file} (${res.status})`);
    return parseList(await res.text());
  }

  async function updateListInfo() {
    el.listInfo.textContent = "";
    if (!el.listSelect.value) return;
    try {
      const words = await fetchWords(el.listSelect.value);
      el.listInfo.textContent = `${words.length} expression${words.length > 1 ? "s" : ""}`;
    } catch {
      el.listInfo.textContent = "";
    }
  }

  /* ---------- Jeu ---------- */
  async function startGame() {
    el.setupError.textContent = "";
    saveSettings();
    try {
      const words = await fetchWords(state.settings.list);
      if (!words.length) throw new Error("Cette liste est vide.");
      state.words = shuffle(words);
      state.index = 0;
      show("screen-ready");
    } catch (e) {
      el.setupError.textContent = e.message;
    }
  }

  function currentWord() {
    if (state.index >= state.words.length) {
      // Liste épuisée : on remélange
      state.words = shuffle(state.words);
      state.index = 0;
    }
    return state.words[state.index];
  }

  function displayWord() {
    el.word.textContent = currentWord();
  }

  function nextWord() {
    state.index++;
    displayWord();
  }

  function updateHud() {
    el.timer.textContent = state.timeLeft;
    el.timer.classList.toggle("low", state.timeLeft <= 10);
    el.score.textContent = `Score : ${state.score}`;
    if (state.settings.unlimited) {
      el.skips.textContent = "Passes : ∞";
      el.btnSkip.disabled = false;
    } else {
      el.skips.textContent = `Passes : ${state.skipsLeft}`;
      el.btnSkip.disabled = state.skipsLeft <= 0;
    }
  }

  function startRound() {
    state.score = 0;
    state.skipsLeft = state.settings.maxSkips;
    state.timeLeft = state.settings.duration;
    state.paused = false;
    el.btnPause.textContent = "⏸";
    el.btnFound.disabled = false;
    show("screen-game");
    displayWord();
    updateHud();

    clearInterval(state.interval);
    state.interval = setInterval(() => {
      if (state.paused) return;
      state.timeLeft--;
      updateHud();
      if (state.timeLeft <= 0) endRound();
    }, 1000);
  }

  function found() {
    if (state.paused) return;
    state.score++;
    nextWord();
    updateHud();
  }

  function skip() {
    if (state.paused) return;
    if (!state.settings.unlimited) {
      if (state.skipsLeft <= 0) return;
      state.skipsLeft--;
    }
    nextWord();
    updateHud();
  }

  function togglePause() {
    state.paused = !state.paused;
    el.btnPause.textContent = state.paused ? "▶️" : "⏸";
    el.btnFound.disabled = state.paused;
    el.btnSkip.disabled = state.paused || (!state.settings.unlimited && state.skipsLeft <= 0);
    el.word.textContent = state.paused ? "⏸ Pause" : currentWord();
  }

  function endRound() {
    clearInterval(state.interval);
    state.index++; // ne pas réutiliser le mot en cours
    el.endScore.textContent = `${state.score} expression${state.score > 1 ? "s" : ""} trouvée${state.score > 1 ? "s" : ""}`;
    show("screen-end");
  }

  /* ---------- Initialisation ---------- */
  async function init() {
    try {
      state.catalog = await loadCatalog();
    } catch (e) {
      el.setupError.textContent = e.message;
      return;
    }
    if (!state.catalog.length) {
      el.setupError.textContent = "Aucune liste trouvée dans le dossier lists.";
      return;
    }

    el.listSelect.innerHTML = "";
    state.catalog.forEach(({ file, name }) => {
      const opt = document.createElement("option");
      opt.value = file;
      opt.textContent = name || file;
      el.listSelect.appendChild(opt);
    });

    loadSettings();
    if (state.catalog.some((c) => c.file === state.settings.list)) {
      el.listSelect.value = state.settings.list;
    }
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
  $("btn-next-turn").addEventListener("click", () => show("screen-ready"));
  document.querySelectorAll('[data-action="to-setup"]').forEach((b) =>
    b.addEventListener("click", () => {
      clearInterval(state.interval);
      show("screen-setup");
    })
  );

  // Raccourcis clavier (ordinateur)
  document.addEventListener("keydown", (e) => {
    if (!$("screen-game").classList.contains("active")) return;
    if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); found(); }
    if (e.code === "ArrowRight") skip();
    if (e.code === "KeyP") togglePause();
  });

  init();
})();
