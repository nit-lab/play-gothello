const menu = document.querySelector("#game-menu");
const openMenu = document.querySelector("#open-menu");
const closeMenuButton = document.querySelector("#close-menu");
const menuPanel = menu.querySelector(".menu-panel");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let menuOpenTimer;
let menuCloseTimer;
const form = document.querySelector("#start-form");
const sides = document.querySelector("#side-controls");
const start = document.querySelector("#start");
const board = document.querySelector("#board");
const status = document.querySelector("#status");
const aiSearch = document.querySelector("#ai-search");
const download = document.querySelector("#download");
const profileFile = document.querySelector("#profile-file");
const profileName = document.querySelector("#profile-name");
const profileMessage = document.querySelector("#profile-message");
const resetProfile = document.querySelector("#reset-profile");
const marks = ["空き", "◯", "✕"];
const cells = [];

let worker;
let pending;
let ready = false;
let busy = false;
let failed = false;
let state = { profile: null, match: null };
let recordURL;

for (let index = 0; index < 25; index++) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "square";
  const stone = document.createElement("span");
  stone.setAttribute("aria-hidden", "true");
  button.append(stone);
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "false") {
      void run(async () => {
        state = await request({ action: "play", move: index });
        await replyIfNeeded();
      });
    }
  });
  board.append(button);
  cells.push({ button, stone, name: `${"ABCDE"[index % 5]}${Math.floor(index / 5) + 1}` });
}

function render() {
  const match = state.match;
  const disabled = !ready || busy || failed;
  sides.disabled = disabled;
  start.disabled = disabled;
  start.textContent = match ? "新しい対局" : "対局を始める";
  profileFile.disabled = disabled;
  resetProfile.disabled = disabled || !state.profile;
  profileName.textContent = state.profile
    ? `四隅 ${state.profile.corner_weight} / 石数 ${state.profile.mark_weight}`
    : "標準設定";

  if (!failed && ready) {
    if (!match) status.textContent = "先攻か後攻を選んで対局を始めてください。";
    else if (match.outcome === 3) status.textContent = "引き分け";
    else if (match.outcome) status.textContent = match.outcome === match.human ? "あなたの勝ち" : "AIの勝ち";
    else if (match.turn === match.human) status.textContent = `あなたの番（${marks[match.human]}）`;
    else status.textContent = "AIが考えています…";
  }

  const canPlay = !disabled && match && match.outcome === 0 && match.turn === match.human;
  cells.forEach(({ button, stone, name }, index) => {
    const mark = match?.cells[index] ?? 0;
    button.setAttribute("aria-label", `${name} ${marks[mark]}`);
    button.setAttribute("aria-disabled", String(!canPlay || mark !== 0));
    button.classList.toggle("last", match?.last === index);
    stone.className = mark === 1 ? "stone circle" : mark === 2 ? "stone cross" : "";
  });

  const search = match?.lastSearch;
  aiSearch.hidden = !search;
  if (search) {
    const move = cells[search.move].name;
    const score = search.score > 0 ? "+" + search.score : search.score;
    const summary = search.depth > 0
      ? search.depth + "手先まで · 評価 " + score + "点（AI視点）"
      : "読み切った深さなし";
    const label = "AIの直近の手 " + move + " · " + summary;
    if (aiSearch.textContent !== label) aiSearch.textContent = label;
  } else {
    aiSearch.textContent = "";
  }

  if (!match?.record && recordURL) {
    URL.revokeObjectURL(recordURL);
    recordURL = undefined;
    download.removeAttribute("href");
  }
  if (match?.record && !recordURL) {
    recordURL = URL.createObjectURL(new Blob([match.record], { type: "application/x-ndjson" }));
    download.href = recordURL;
  }
  download.hidden = !recordURL;
}

function request(command) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker.postMessage(command);
  });
}

async function replyIfNeeded() {
  render();
  const match = state.match;
  if (!match.outcome && match.turn !== match.human) {
    state = await request({ action: "reply" });
  }
}

async function run(action, onError = showGameError) {
  busy = true;
  render();
  try {
    await action();
  } catch (error) {
    if (!failed) onError(error);
  } finally {
    busy = false;
    render();
  }
}

function showGameError(error) {
  failed = true;
  status.textContent = `対局を続けられません。ページを再読み込みしてください。 ${error.message}`;
}

function announceProfile(message) {
  profileMessage.hidden = false;
  profileMessage.textContent = message;
}

openMenu.addEventListener("click", () => {
  if (!reducedMotion.matches) {
    menu.classList.add("opening");
    menuOpenTimer = setTimeout(() => menu.classList.remove("opening"), 250);
  }
  menu.showModal();
});

function dismissMenu() {
  if (!menu.open || menu.classList.contains("closing")) return;
  if (reducedMotion.matches) {
    menu.close();
    return;
  }

  menuPanel.style.setProperty("--close-from", getComputedStyle(menuPanel).transform);
  clearTimeout(menuOpenTimer);
  menu.classList.remove("opening");
  menu.classList.add("closing");
  // Close even if animation events are suspended while the page is hidden.
  menuCloseTimer = setTimeout(() => menu.close(), 230);
}

menuPanel.addEventListener("animationend", event => {
  if (event.animationName === "menu-slide-out") menu.close();
});
closeMenuButton.addEventListener("click", dismissMenu);
menu.addEventListener("click", event => {
  if (event.target === menu) dismissMenu();
});
menu.addEventListener("cancel", event => {
  event.preventDefault();
  dismissMenu();
});
menu.addEventListener("close", () => {
  clearTimeout(menuOpenTimer);
  clearTimeout(menuCloseTimer);
  menuPanel.style.removeProperty("--close-from");
  menu.classList.remove("opening", "closing");
  openMenu.focus();
});

form.addEventListener("submit", event => {
  event.preventDefault();
  if (start.disabled) return;
  const human = Number(form.elements.side.value);
  void run(async () => {
    state = await request({ action: "start", human });
    profileMessage.hidden = true;
    await replyIfNeeded();
  });
});

profileFile.addEventListener("change", () => {
  const file = profileFile.files[0];
  profileFile.value = "";
  if (!file) return;
  void run(async () => {
    state = await request({ action: "profile", profile: await file.text() });
    announceProfile("評価設定を読み込みました。次の対局で使います。");
  }, error => announceProfile(`読み込めませんでした。 ${error.message}`));
});

resetProfile.addEventListener("click", () => {
  void run(async () => {
    state = await request({ action: "default" });
    announceProfile("次の対局から標準設定を使います。");
  });
});

function workerFailed(message) {
  const error = new Error(message);
  showGameError(error);
  pending?.reject(error);
  pending = undefined;
  worker?.terminate();
  render();
}

render();
try {
  worker = new Worker(new URL("./worker.js", import.meta.url));
  worker.addEventListener("message", ({ data }) => {
    if (data.ready) {
      ready = true;
      render();
    } else if (data.fatal) {
      workerFailed(data.fatal);
    } else if (pending) {
      const { resolve, reject } = pending;
      pending = undefined;
      if (data.error) reject(new Error(data.error));
      else resolve(data.state);
    }
  });
  worker.addEventListener("error", event => workerFailed(event.message));
} catch (error) {
  workerFailed(error.message);
}
