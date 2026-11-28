const menu = document.querySelector("#game-menu");
const openMenu = document.querySelector("#open-menu");
const closeMenuButton = document.querySelector("#close-menu");
const sides = [...document.querySelectorAll(".side-button")];
const board = document.querySelector("#board");
const status = document.querySelector("#status");
const aiSearch = document.querySelector("#ai-search");
const humanSearch = document.querySelector("#human-search");
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
const minimumReplyDelay = 250;
const pending = [];

let worker;
let ready = false;
let busy = false;
let waitingForAI = false;
let undoRequested = false;
let failed = false;
let state = { profile: null, match: null };
let recordURL;
let resultDismissed = false;
let leadingSide = 0;

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
        highlightMove(state.match.last, "human");
        await replyIfNeeded(minimumReplyDelay);
      });
    }
  });
  board.append(button);
  cells.push({ button, stone, name: `${"ABCDE"[index % 5]}${Math.floor(index / 5) + 1}` });
}

function render() {
  const match = state.match;
  const disabled = !ready || busy || failed;
  if (!match || match.outcome) {
    leadingSide = 0;
  } else if (!busy) {
    const latest = match.turn === match.human ? match.lastAI : match.lastHuman;
    if (!latest || latest.search) {
      const score = latest?.search.depth > 0 ? latest.search.score : 0;
      leadingSide = Math.abs(score) < leadThreshold ? 0 : score > 0 ? 1 : 2;
    }
  }
  for (const button of sides) {
    const side = Number(button.dataset.side);
    const active = match?.outcome === 0 && match.turn === side;
    const yourTurn = active && side === match.human;
    const note = yourTurn ? "あなたの番" : active ? "AI思考中" : "";
    button.disabled = disabled;
    button.classList.toggle("your-turn", yourTurn);
    const isLeading = leadingSide === side;
    button.classList.toggle("leading", isLeading);
    button.querySelector(".side-lead").hidden = !isLeading;
    button.setAttribute("aria-label", [
      side === 1 ? "先攻" : "後攻",
      isLeading ? "優勢" : "",
      note,
    ].filter(Boolean).join("、"));
    const label = button.querySelector(".side-note");
    if (label.textContent !== note) label.textContent = note;
  }
  const canReview = Boolean(match?.record);
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

  renderReview(aiSearch, match, false);
  renderReview(humanSearch, match, true);

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

function highlightMove(index, player) {
  cells[index].button.dataset.moveHighlight = player;
}

function clearMoveHighlights() {
  for (const { button } of cells) delete button.dataset.moveHighlight;
}

function clearReviewSnapshot() {
  if (history.state?.reviewSnapshot) history.replaceState(null, "");
}

function renderReview(row, match, isHuman) {
  const review = isHuman ? match?.lastHuman : match?.lastAI;
  const side = match && (isHuman ? match.human : 3 - match.human);
  const active = match?.outcome === 0 && match.turn === side;
  const player = row.querySelector(".move-player");
  player.classList.toggle("current-turn", active);
  if (active) player.setAttribute("aria-current", "true");
  else player.removeAttribute("aria-current");

  const coordinate = row.querySelector(".move-coordinate");
  const move = review ? cells[review.move].name : "—";
  if (coordinate.textContent !== move) coordinate.textContent = move;

  let label = "";
  if (review?.outcome) {
    label = review.outcome === 3 ? "引き分け" : review.outcome === match.human ? "あなたの勝ち" : "AIの勝ち";
  } else if (review?.search?.depth > 0) {
    const { depth, score } = review.search;
    const ownScore = side === 2 ? -score : score;
    label = `${depth}手先 · 評価 ${ownScore > 0 ? "+" : ""}${ownScore}点`;
  } else if (review) {
    label = review.search ? "読み切った深さなし" : "探索中…";
  }
  const evaluation = row.querySelector(".move-evaluation");
  if (evaluation.textContent !== label) evaluation.textContent = label;
}

function request(command) {
  return new Promise((resolve, reject) => {
    worker.postMessage(command);
    pending.push({ resolve, reject });
  });
}

async function replyIfNeeded(delay = 0) {
  const match = state.match;
  if (match.outcome || match.turn === match.human) return;

  waitingForAI = true;
  render();
  try {
    const [reply] = await Promise.all([
      request({ action: "reply" }),
      delay && new Promise(resolve => setTimeout(resolve, delay)),
    ]);
    if (failed) return;
    // Skip a reply if the player took back their move before it was shown.
    if (undoRequested) {
      state = await request({ action: "undo" });
      return;
    }
    state = reply;
    highlightMove(reply.match.last, "ai");
    if (reply.match.outcome === 0) void reviewReply(reply);
  } finally {
    waitingForAI = false;
    undoRequested = false;
  }
}

async function reviewReply(reply) {
  try {
    // The Worker processes commands serially. The player can choose their
    // next move while this evaluation is running.
    const review = await request({ action: "review" });
    if (state === reply) {
      state = review;
      render();
    }
  } catch (error) {
    if (!failed) {
      showGameError(error);
      render();
    }
  }
}

openReview.addEventListener("click", () => {
  void run(async () => {
    const { snapshot } = await request({ action: "save-review" });
    sessionStorage.setItem(reviewRecordKey, state.match.record);
    history.replaceState({ reviewSnapshot: snapshot, resultDismissed }, "");
    window.location.assign("./review.html");
  }, () => {
    reviewOpenError.textContent = "棋譜を振り返りページに渡せませんでした。";
    reviewOpenError.hidden = false;
  });
});

matchAction.addEventListener("click", () => {
  clearMoveHighlights();
  if (waitingForAI) {
    undoRequested = true;
    render();
    return;
  }
  const record = state.match?.record;
  void run(async () => {
    state = await request({ action: "undo" });
    resultDismissed = false;
    clearReviewSnapshot();
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
  if (state.match?.outcome && !resultDismissed &&
      !status.contains(event.target) && !openReview.contains(event.target)) {
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
      clearMoveHighlights();
      clearReviewSnapshot();
      leadingSide = 0;
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
  for (const { reject } of pending.splice(0)) reject(error);
  worker?.terminate();
  render();
}

render();
try {
  worker = new Worker(new URL("./worker.js", import.meta.url));
  worker.addEventListener("message", ({ data }) => {
    if (data.ready) {
      const saved = history.state;
      if (saved?.reviewSnapshot) {
        void run(async () => {
          try {
            state = await request({ action: "restore-review", snapshot: saved.reviewSnapshot });
            resultDismissed = Boolean(saved.resultDismissed);
          } finally {
            ready = true;
          }
        }, clearReviewSnapshot);
      } else {
        ready = true;
        render();
      }
    } else if (data.fatal) {
      workerFailed(data.fatal);
    } else if (pending.length) {
      const { resolve, reject } = pending.shift();
      if (data.error) reject(new Error(data.error));
      else resolve(data.state);
    }
  });
  worker.addEventListener("error", event => workerFailed(event.message));
} catch (error) {
  workerFailed(error.message);
}
