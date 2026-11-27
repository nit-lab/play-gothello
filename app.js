const menu = document.querySelector("#game-menu");
const openMenu = document.querySelector("#open-menu");
const closeMenuButton = document.querySelector("#close-menu");
const sides = [...document.querySelectorAll(".side-button")];
const board = document.querySelector("#board");
const status = document.querySelector("#status");
const aiSearch = document.querySelector("#ai-search");
const humanSearch = document.querySelector("#human-search");
const moveReviews = document.querySelector("#move-reviews");
const openReview = document.querySelector("#open-review");
const matchAction = document.querySelector("#match-action");
const download = document.querySelector("#download");
const reviewOpenError = document.querySelector("#review-open-error");
const budget = document.querySelector("#search-budget");
const budgetValue = document.querySelector("#search-budget-value");
const budgetStorageKey = "gothello.searchBudget";
const nodeFormat = new Intl.NumberFormat("ja-JP");
const profileFile = document.querySelector("#profile-file");
const profileName = document.querySelector("#profile-name");
const profileMessage = document.querySelector("#profile-message");
const resetProfile = document.querySelector("#reset-profile");
const marks = ["空き", "◯", "✕"];
const leadThreshold = 3;
const reviewRecordKey = "gothello.reviewRecord";
const cells = [];

let worker;
let pending;
let ready = false;
let busy = false;
let waitingForAI = false;
let undoRequested = false;
let failed = false;
let state = { profile: null, match: null };
let recordURL;
let resultDismissed = false;

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
  const latest = match?.turn === match?.human ? match?.lastAI : match?.lastHuman;
  const currentScore = match?.outcome === 0 && latest?.search?.depth > 0 ? latest.search.score : 0;
  const leadingSide = Math.abs(currentScore) < leadThreshold ? 0 : currentScore > 0 ? 1 : 2;
  for (const button of sides) {
    const side = Number(button.dataset.side);
    const active = match?.outcome === 0 && match.turn === side;
    const yourTurn = active && side === match.human;
    const note = yourTurn ? "あなたの番" : active ? "AI思考中" : "";
    button.disabled = disabled;
    button.classList.toggle("your-turn", yourTurn);
    button.classList.toggle("leading", leadingSide === side);
    button.setAttribute("aria-label", [
      side === 1 ? "先攻" : "後攻",
      leadingSide === side ? "優勢" : "",
      note,
    ].filter(Boolean).join("、"));
    const label = button.querySelector(".side-note");
    if (label.textContent !== note) label.textContent = note;
  }
  const canReview = Boolean(match?.record);
  moveReviews.hidden = canReview;
  openReview.hidden = !canReview;
  openReview.disabled = disabled;
  matchAction.hidden = !match;
  matchAction.disabled = !ready || failed || !match?.canUndo || undoRequested || (busy && !waitingForAI);
  profileFile.disabled = disabled;
  resetProfile.disabled = disabled || !state.profile;
  profileName.textContent = state.profile
    ? `四隅 ${state.profile.corner_weight} / 石数 ${state.profile.mark_weight}`
    : "標準設定";

  if (!failed && ready) {
    let message = "";
    if (!match) message = "先攻か後攻を選んで対局開始";
    else if (match.outcome && !resultDismissed) {
      if (match.outcome === 3) message = "引き分け";
      else message = match.outcome === match.human ? "あなたの勝ち" : "AIの勝ち";
    }
    if (status.textContent !== message) status.textContent = message;
    status.classList.toggle("result", Boolean(match?.outcome && !resultDismissed));
    status.hidden = !message;
  }

  const canPlay = !disabled && match && match.outcome === 0 && match.turn === match.human;
  cells.forEach(({ button, stone, name }, index) => {
    const mark = match?.cells[index] ?? 0;
    button.setAttribute("aria-label", `${name} ${marks[mark]}`);
    button.setAttribute("aria-disabled", String(!canPlay || mark !== 0));
    button.classList.toggle("last", match?.last === index);
    button.classList.toggle("winning", Boolean(match?.winning & (1 << index)));
    stone.className = mark === 1 ? "stone circle" : mark === 2 ? "stone cross" : "";
  });

  renderReview(aiSearch, "AIの手", match?.lastAI);
  renderReview(humanSearch, "あなたの手", match?.lastHuman);

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
  if (!match?.record) reviewOpenError.hidden = true;
}

function openGameReview(record) {
  try {
    sessionStorage.setItem(reviewRecordKey, record);
  } catch {
    reviewOpenError.textContent = "棋譜を振り返りページに渡せませんでした。";
    reviewOpenError.hidden = false;
    return;
  }
  window.location.assign("./review.html");
}

function renderReview(row, name, review) {
  let label = name + " —";
  if (review) {
    label = name + " " + cells[review.move].name + " · ";
    if (review.outcome) {
      label += ["", "先攻勝ち", "後攻勝ち", "引き分け"][review.outcome];
    } else if (!review.search) {
      label += "探索中…";
    } else if (review.search.depth === 0) {
      label += "読み切った深さなし";
    } else {
      const { depth, score } = review.search;
      label += `${depth}手先 · 評価 ${score > 0 ? "+" : ""}${score}点（先攻視点）`;
    }
  }
  if (row.textContent !== label) row.textContent = label;
}

function request(command) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    worker.postMessage(command);
  });
}

async function replyIfNeeded() {
  const match = state.match;
  if (match.outcome || match.turn === match.human) return;

  waitingForAI = true;
  render();
  try {
    const reply = await request({ action: "reply" });
    // The Worker processes requests in order. Skip rendering a reply that
    // arrived after the player took back their move.
    if (undoRequested) {
      state = await request({ action: "undo" });
      return;
    }
    state = reply;
    if (state.match.outcome === 0) {
      render();
      const review = await request({ action: "review" });
      state = undoRequested ? await request({ action: "undo" }) : review;
    }
  } finally {
    waitingForAI = false;
    undoRequested = false;
  }
}

openReview.addEventListener("click", () => openGameReview(state.match.record));

matchAction.addEventListener("click", () => {
  if (waitingForAI) {
    undoRequested = true;
    render();
    return;
  }
  const record = state.match?.record;
  void run(async () => {
    state = await request({ action: "undo" });
    resultDismissed = false;
    if (!record) return;
    try {
      if (sessionStorage.getItem(reviewRecordKey) === record) {
        sessionStorage.removeItem(reviewRecordKey);
      }
    } catch {
      // Storage may be unavailable, but the game can still resume.
    }
  });
});

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
  status.hidden = false;
  status.classList.remove("result");
  status.textContent = `対局を続けられません。ページを再読み込みしてください。 ${error.message}`;
}

function announceProfile(message) {
  profileMessage.hidden = false;
  profileMessage.textContent = message;
}

openMenu.addEventListener("click", () => menu.showModal());
closeMenuButton.addEventListener("click", () => menu.close());
menu.addEventListener("click", event => {
  if (event.target === menu) menu.close();
});
menu.addEventListener("close", () => openMenu.focus());

document.addEventListener("click", event => {
  if (state.match?.outcome && !resultDismissed && !status.contains(event.target)) {
    resultDismissed = true;
    render();
  }
}, { capture: true });

function renderBudget() {
  const label = nodeFormat.format(budget.valueAsNumber) + " ノード／手";
  budgetValue.value = label;
  budget.setAttribute("aria-valuetext", label);
}

function restoreBudget() {
  try {
    const stored = localStorage.getItem(budgetStorageKey);
    const nodes = Number(stored);
    const minimum = Number(budget.min);
    if (String(nodes) === stored && Number.isInteger(nodes) &&
        nodes >= minimum && nodes <= Number(budget.max) &&
        (nodes - minimum) % Number(budget.step) === 0) {
      budget.valueAsNumber = nodes;
    }
  } catch {
    // The slider keeps its default when storage is unavailable.
  }
}

budget.addEventListener("input", () => {
  renderBudget();
  try {
    localStorage.setItem(budgetStorageKey, budget.value);
  } catch {
    // The current selection still applies to the next game in this page.
  }
});
restoreBudget();
renderBudget();

for (const button of sides) {
  button.addEventListener("click", () => {
    if (state.match?.outcome === 0 && !window.confirm("今の対局を終了して始め直しますか？")) return;
    void run(async () => {
      state = await request({ action: "start", human: Number(button.dataset.side), nodes: budget.valueAsNumber });
      resultDismissed = false;
      profileMessage.hidden = true;
      await replyIfNeeded();
    });
  });
}

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
