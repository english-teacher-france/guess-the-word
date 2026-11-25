(() => {
  const $ = (id) => document.getElementById(id);
  const screens = document.querySelectorAll(".screen");

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
    endTitle: $("end-title"),
    endScore: $("end-score"),
    btnPause: $("btn-pause"),
    btnSkip: $("btn-skip"),
  };

  const state = {
    catalog: [],
    words: [],        // mots mélangés
    index: 0,
    score: 0,
    skipsLeft: 0,
    timeLeft: 0,
    interval: null,
    paused: false,
    settings: { duration: 60, maxSkips: 3, unlimited: false, list: "" },
  };

  /* ---------- Utilitaires ---------- */
  function show(id) {
    screens.forEach((s) => s.classList.toggle("active", s.id === id));
  }

  // Fisher-Yates
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function saveSettings() {
    localStorage.setItem("taboo-settings", JSON.stringify(state.settings));
  }
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

  async function fetchWords(file) {
    const res = await fetch(`lists/${encodeURIComponent(file)}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Impossible de charger ${file}`);
    const text = await res.text();
    return [...new Set(
      text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    )];
  }

  /* ---------- Initialisation ---------- */
  async function init() {
    try {
      const res = await fetch("lists/index.json", { cache: "no-cache" });
      state.catalog = await res.json();
    } catch {
      el.setupError.textContent =
        "Impossible de lire lists/index.json (le site doit être servi via http, pas en file://).";
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

  async function updateListInfo() {
    el.listInfo.textContent = "";
    try {
      const words = await fetchWords(el.listSelect.value);
      el.listInfo.textContent = `${words.length} expression(s)`;
    } catch {
      el.listInfo.textContent = "Liste introuvable";
    }
  }

  /* ---------- Partie ---------- */
  async function startGame() {
    el.setupError.textContent = "";

    const duration = parseInt(el.duration.value, 10);
    const maxSkips = parseInt(el.maxSkips.value, 10);
    if (!(duration >= 5)) return (el.setupError.textContent = "Durée invalide.");

    state.settings = {
      duration,
      maxSkips: isNaN(maxSkips) ? 0 : maxSkips,
      unlimited: el.unlimited.checked,
      list: el.listSelect.value,
    };
    saveSettings();

    try {
      const words = await fetchWords(state.settings.list);
      if (!words.length) throw new Error("La liste est vide.");
      state.words = shuffle(words);
      state.index = 0;
    } catch (e) {
      el.setupError.textContent = e.message;
      return;
    }
    show("screen-ready");
  }

  function startRound() {
    state.score = 0;
    state.skipsLeft = state.settings.unlimited ? Infinity : state.settings.maxSkips;
    state.timeLeft = state.settings.duration;
    state.paused = false;
    el.btnPause.textContent = "⏸ Pause";
    updateHud();
    showWord();
    show("screen-game");

    clearInterval(state.interval);
    state.interval = setInterval(tick, 1000);
  }

  function tick() {
    if (state.paused) return;
    state.timeLeft--;
    updateHud();
    if (state.timeLeft <= 0) endRound("Temps écoulé !");
  }

  function currentWord() {
    return state.words[state.index];
  }

  function nextWord() {
    state.index++;
    if (state.index >= state.words.length) {
      // Fin de liste : on remélange en évitant de répéter le dernier mot
      const last = currentWordSafe();
      state.words = shuffle(state.words);
      if (state.words.length > 1 && state.words[0] === last) {
        [state.words[0], state.words[1]] = [state.words[1], state.words[0]];
      }
      state.index = 0;
    }
    showWord();
  }
  function currentWordSafe() {
    return state.words[(state.index - 1 + state.words.length) % state.words.length];
  }

  function showWord() {
    el.word.textContent = currentWord();
  }

  function updateHud() {
    el.timer.textContent = state.timeLeft;
    el.timer.classList.toggle("low", state.timeLeft <= 10);
    el.score.textContent = `✅ ${state.score}`;
    el.skips.textContent =
      state.skipsLeft === Infinity ? "⏭️ ∞" : `⏭️ ${state.skipsLeft}`;
    el.btnSkip.disabled = state.skipsLeft <= 0;
  }

  function found() {
    if (state.paused) return;
    state.score++;
    updateHud();
    nextWord();
  }

  function skip() {
    if (state.paused || state.skipsLeft <= 0) return;
    if (state.skipsLeft !== Infinity) state.skipsLeft--;
    updateHud();
    nextWord();
  }

  function togglePause() {
    state.paused = !state.paused;
    el.btnPause.textContent = state.paused ? "▶ Reprendre" : "⏸ Pause";
    el.word.style.visibility = state.paused ? "hidden" : "visible";
  }

  function endRound(title) {
    clearInterval(state.interval);
    el.word.style.visibility = "visible";
    el.endTitle.textContent = title;
    el.endScore.textContent = state.score;
    if (navigator.vibrate) navigator.vibrate(300);
    show("screen-end");
  }

  /* ---------- Événements ---------- */
  el.listSelect.addEventListener("change", updateListInfo);
  el.unlimited.addEventListener("change", () => {
    el.maxSkips.disabled = el.unlimited.checked;
  });
  $("btn-start").addEventListener("click", startGame);
  $("btn-go").addEventListener("click", startRound);
  $("btn-found").addEventListener("click", found);
  $("btn-skip").addEventListener("click", skip);
  $("btn-pause").addEventListener("click", togglePause);
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
