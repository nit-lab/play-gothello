const status = document.querySelector("#review-status");
const result = document.querySelector("#review-result");
const turningPoints = document.querySelector("#review-turning-points");
const turningLinks = turningPoints.querySelector("ul");
const timeline = document.querySelector("#review-timeline");
const plies = document.querySelector("#review-plies");
const sides = ["", "先攻", "後攻"];
const results = ["", "先攻の勝ち", "後攻の勝ち", "引き分け"];
const marks = ["", "◯", "✕"];
const columns = "ABCDE";
const rows = "12345";
const scoreSwing = 6;
const maxHighlights = 3;

const matchLink = document.querySelector("#return-to-match");
const referrer = document.referrer ? new URL(document.referrer) : null;
if (referrer?.origin === location.origin &&
    [new URL("./", location.href).pathname, new URL("./index.html", location.href).pathname].includes(referrer.pathname)) {
  history.replaceState({ returnToMatch: true }, "");
}
function plainClick(event) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
matchLink.addEventListener("click", event => {
  if (history.state?.returnToMatch && plainClick(event)) {
    event.preventDefault();
    history.back();
  }
});
turningLinks.addEventListener("click", event => {
  const link = event.target.closest("a");
  if (!link || !plainClick(event)) return;
  const target = document.getElementById(link.hash.slice(1));
  if (!target) return;
  event.preventDefault();
  history.replaceState(history.state, "", link.hash);
  target.focus();
  target.scrollIntoView();
});

function coordinate(index) {
  return columns[index % 5] + rows[Math.floor(index / 5)];
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function axis(className, labels) {
  const line = element("div", className);
  for (const label of labels) line.append(element("span", "", label));
  return line;
}

function reviewBoard(ply) {
  const frame = element("div", "board-frame review-board");
  const grid = element("div", "board");
  const placements = [[], [], []];
  const flips = [];

  for (const [index, mark] of ply.cells.entries()) {
    const name = coordinate(index);
    const square = element("span", "square");
    if (index === ply.move) square.classList.add("last");
    if (ply.flipped & (1 << index)) {
      square.classList.add("flipped");
      flips.push(name);
    }
    if (mark) {
      placements[mark].push(name);
      square.append(element("span", mark === 1 ? "stone circle" : "stone cross"));
    }
    grid.append(square);
  }

  let description = sides[ply.player] + "が" + coordinate(ply.move) + "に着手。";
  if (flips.length) description += flips.join("、") + "が反転。";
  for (const mark of [1, 2]) {
    description += marks[mark] + " " + (placements[mark].join("、") || "なし") + "。";
  }
  frame.setAttribute("role", "img");
  frame.setAttribute("aria-label", description);
  frame.append(axis("columns", columns), axis("rows", rows), grid);
  return { frame, flips };
}

function positionName(evaluation) {
  return evaluation.leader ? sides[evaluation.leader] + "優勢" : "互角";
}

function stateLabel(evaluation) {
  switch (evaluation.kind) {
    case "result":
      return results[evaluation.leader || 3] + " · 終局";
    case "immediate":
      return positionName(evaluation) + " · 次の一手で勝てる";
    case "exact":
      return (evaluation.leader ? positionName(evaluation) : "引き分け") + " · 終盤の確定結果";
    default:
      return positionName(evaluation) + " · 探索による推定";
  }
}

function estimateSwing(before, current) {
  return before.kind === "estimate" && current.kind === "estimate"
    && Math.abs(before.score - current.score) >= scoreSwing;
}

function highlightPriority(before, current) {
  if (!before || current.kind === "result") return 0;
  const leadChanged = before.leader !== current.leader;
  if (leadChanged && before.leader && current.leader) return 4;
  if (before.kind !== current.kind && (current.kind === "immediate" || current.kind === "exact")) {
    return 3;
  }
  if (leadChanged) return 2;
  return estimateSwing(before, current) ? 1 : 0;
}

function comment(evaluation, before) {
  switch (evaluation.kind) {
    case "result":
      return evaluation.leader
        ? sides[evaluation.leader] + "が5つ並べて勝ちました。"
        : "すべてのマスが埋まり、5つ並んだ列はありませんでした。";
    case "immediate":
      return sides[evaluation.leader] + "は次に" + coordinate(evaluation.winning) + "に置くと5つ並びます。";
    case "exact":
      return evaluation.leader
        ? "互いに最善を尽くすと" + sides[evaluation.leader] + "が勝つ局面です。"
        : "互いに最善を尽くすと引き分けになる局面です。";
    default:
      if (!before) return "この局面から" + positionName(evaluation) + "と読んでいます。";
      if (before.leader !== evaluation.leader) {
        return evaluation.leader
          ? sides[evaluation.leader] + "に形勢が傾きました。"
          : "形勢は互角に戻りました。";
      }
      if (estimateSwing(before, evaluation)) {
        const sign = evaluation.leader === 1 ? 1 : -1;
        return sign * (evaluation.score - before.score) > 0
          ? sides[evaluation.leader] + "のリードが広がりました。"
          : sides[evaluation.leader] + "のリードが縮まりました。";
      }
      return "形勢はほぼ変わらず、" + positionName(evaluation) + "です。";
  }
}

function render(report, record) {
  result.textContent = results[report.outcome] + " · 全" + report.plies.length + "手";
  const highlights = [];
  let before;

  for (const [index, ply] of report.plies.entries()) {
    const evaluation = ply.evaluation;
    const card = element("li", "review-ply");
    card.id = "review-ply-" + (index + 1);
    card.tabIndex = -1;
    const title = (index + 1) + "手目 · " + coordinate(ply.move);
    const details = element("div", "review-details");
    const { frame, flips } = reviewBoard(ply);
    details.append(
      element("h3", "", title),
      element("p", "review-player", sides[ply.player] + " " + marks[ply.player] + (ply.human ? "（あなた）" : "（AI）")),
      element("p", "review-evaluation", stateLabel(evaluation)),
      element("p", "review-comment", comment(evaluation, before)),
    );
    if (flips.length) {
      details.append(element("p", "review-flips", "反転 " + flips.join("、")));
    }
    card.append(details, frame);
    plies.append(card);

    const priority = highlightPriority(before, evaluation);
    if (priority) {
      highlights.push({ index, priority, id: card.id, label: title + " · " + stateLabel(evaluation) });
    }
    before = evaluation;
  }

  const featured = highlights.sort((a, b) => b.priority - a.priority)
    .slice(0, maxHighlights)
    .sort((a, b) => a.index - b.index);
  for (const { id, label } of featured) {
    const item = element("li");
    const link = element("a", "", label);
    link.href = "#" + id;
    item.append(link);
    turningLinks.append(item);
  }

  const recordURL = URL.createObjectURL(new Blob([record], { type: "application/x-ndjson" }));
  for (const download of document.querySelectorAll(".download")) {
    download.href = recordURL;
    download.hidden = false;
  }

  result.hidden = false;
  timeline.hidden = false;
  turningPoints.hidden = turningLinks.children.length === 0;
  status.hidden = true;
}

function analyze(record) {
  const worker = new Worker(new URL("./worker.js", import.meta.url));
  const fail = () => {
    worker.terminate();
    status.textContent = "棋譜を分析できませんでした。";
  };
  worker.addEventListener("error", fail);
  worker.addEventListener("message", ({ data }) => {
    if (data.ready) {
      worker.postMessage({ action: "game-review", record });
    } else if (data.review) {
      worker.terminate();
      render(data.review, record);
    } else {
      fail();
    }
  });
}

try {
  const record = sessionStorage.getItem("gothello.reviewRecord");
  if (record) analyze(record);
  else status.textContent = "振り返る棋譜がありません。対局の終局画面から開いてください。";
} catch {
  status.textContent = "棋譜を読み込めませんでした。";
}
