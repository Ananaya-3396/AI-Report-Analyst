// ==========================================================
// AI Report Analyst – Frontend Logic
// ==========================================================

const BACKEND_URL = window.location.origin;
let saveQueue = Promise.resolve();
let cellCount = 0;

// ---- State ----
const state = {
  messages: [],
  datasets: [],
  datasetsError: false,
  selectedDataset: null,
  busy: false,
};

// ---- DOM Refs ----
const $chatMessages    = document.getElementById("chatMessages");
const $emptyState      = document.getElementById("emptyState");
const $emptyText       = document.getElementById("emptyText");
const $chatForm        = document.getElementById("chatForm");
const $chatInput       = document.getElementById("chatInput");
const $sendBtn         = $chatForm.querySelector("button[type='submit']");
const $composerHint    = document.getElementById("composerHint");
const $contextChip     = document.getElementById("contextChip");
const $datasetSearch   = document.getElementById("datasetSearch");
const $datasetList     = document.getElementById("datasetList");
const $datasetCount    = document.getElementById("datasetCount");
const $datasetPill     = document.getElementById("datasetPill");
const $datasetPillName = document.getElementById("datasetPillName");
const $fileInput       = document.getElementById("fileInput");
const $collectionNameInput = document.getElementById("collectionNameInput");
const $fileDrop        = document.getElementById("fileDrop");
const $fileName        = document.getElementById("fileName");
const $uploadBtn       = document.getElementById("uploadBtn");
const $uploadProgress  = document.getElementById("uploadProgress");
const $uploadStatus    = document.getElementById("uploadStatus");
const $uploadPercent   = document.getElementById("uploadPercent");
const $uploadBar       = document.getElementById("uploadBar");
const $toggleSidebar   = document.getElementById("toggleSidebar");
const $themeToggle     = document.getElementById("themeToggle");
const $sidebar         = document.getElementById("sidebar");
const $connectionStatus = document.getElementById("connectionStatus");
const $clearChatBtn    = document.getElementById("clearChatBtn");

const FILE_DROP_TEXT = $fileName.innerHTML;

const ICONS = {
  bot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v2M15 13v2"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>',
  table: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
  copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};

// ==========================================================
// Helpers
// ==========================================================

/**
 * Minimal markdown-like rendering:
 * **bold**, `code`, blockquotes, unordered lists, line breaks
 */
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Fenced code blocks
  html = html.replace(/```[^\n]*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Blockquotes (lines starting with >)
  html = html.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "<br>");

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Inline code `text`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n*)+)/g, (items) => `<ul>${items.replace(/\n+/g, "")}</ul>`);

  // Line breaks (double newline → paragraph gap, single → <br>)
  html = html.replace(/\n{2,}/g, "<br><br>");
  html = html.replace(/\n/g, "<br>");

  return html.trim();
}

const PY_TOKENS = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(\d+(?:\.\d+)?)\b|\b(import|from|as|def|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|with|lambda|try|except|finally|class)\b|\b([A-Za-z_]\w*)(?=\()/g;

/** Builds a syntax-coloured code block from text nodes, so code can never run as markup. */
function highlightPython(code) {
  const pre = document.createElement("pre");
  pre.className = "cell-code";
  let last = 0;
  for (const match of code.matchAll(PY_TOKENS)) {
    pre.append(code.slice(last, match.index));
    const span = document.createElement("span");
    span.className = match[1] ? "tok-com" : match[2] ? "tok-str" : match[3] ? "tok-num" : match[4] ? "tok-kw" : "tok-fn";
    span.textContent = match[0];
    pre.append(span);
    last = match.index + match[0].length;
  }
  pre.append(code.slice(last));
  return pre;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    $chatMessages.scrollTop = $chatMessages.scrollHeight;
  });
}

function updateEmptyState() {
  $emptyState.classList.toggle("hidden", state.messages.length > 0);
}

function autoResizeInput() {
  $chatInput.style.height = "auto";
  $chatInput.style.height = `${$chatInput.scrollHeight}px`;
}

/** Runs saves one at a time, so they are stored in the order they were made. */
function queueSave(path, method, body, onSaved = () => {}) {
  saveQueue = saveQueue
    .then(async () => {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onSaved(await res.json());
    })
    .catch((error) => console.warn("Could not save the chat:", error));
  return saveQueue;
}

function saveSelectedDataset() {
  return queueSave("/api/chat/selected-dataset", "PUT", { selected_dataset: state.selectedDataset });
}

/** Expands a saved question-and-answer turn, or a note, into chat messages. */
function historyItemToMessages(item) {
  if (item.type === "turn") {
    return [
      { role: "user", content: item.question, includeInContext: true, cells: [], historyId: item._id, dataset: item.dataset },
      { role: "assistant", content: item.answer, includeInContext: true, cells: item.cells || [], historyId: item._id },
    ];
  }
  return [{ role: "assistant", content: item.content, includeInContext: true, cells: [], historyId: item._id, note: true }];
}

async function restoreConversation() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/history`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const history = await res.json();
    state.selectedDataset = history.selected_dataset;
    state.messages = history.items.flatMap(historyItemToMessages);
    state.messages.forEach(renderMessage);
    if (state.messages.length) scrollToBottom();
    return state.messages.length > 0;
  } catch (error) {
    console.warn("Could not restore the saved chat:", error);
    return false;
  }
}

function addMessage(role, content, includeInContext = true, cells = [], extra = {}) {
  const message = { role, content, includeInContext, cells, ...extra };
  state.messages.push(message);
  renderMessage(message);
  scrollToBottom();
  return message;
}

function addError(content) {
  return addMessage("assistant", content, true, [], { error: true });
}

/** Shows an app message that should stay in the saved history. The server saves answers itself. */
function addNote(content) {
  const message = addMessage("assistant", content, true, [], { note: true });
  queueSave("/api/chat/notes", "POST", { content }, ({ id }) => {
    message.historyId = id;
  });
}

function renderMessage(message) {
  const isBot = message.role === "assistant" || message.role === "bot";
  const element = !isBot ? renderUserMessage(message)
    : message.note ? renderNote(message)
      : renderBotMessage(message);
  $chatMessages.appendChild(element);
  updateEmptyState();
}

function renderNote({ content }) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg note";
  wrapper.innerHTML = ICONS.check;
  const text = document.createElement("div");
  text.innerHTML = renderMarkdown(content);
  wrapper.appendChild(text);
  return wrapper;
}

function renderBotMessage({ content, cells = [], error }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg bot${error ? " error" : ""}`;

  const head = document.createElement("div");
  head.className = "bot-head";
  head.innerHTML = `<div class="bot-avatar">${ICONS.bot}</div><span class="bot-name">AI Report Analyst</span>`;
  if (cells.length || error) {
    const badge = document.createElement("span");
    badge.className = "bot-badge";
    badge.textContent = error ? "Error" : `${cells.length} ${cells.length === 1 ? "cell" : "cells"} ran`;
    head.appendChild(badge);
  }

  const body = document.createElement("div");
  body.className = "bot-body";
  cells.forEach((cell) => body.appendChild(renderCell(cell)));

  const answer = document.createElement("div");
  answer.className = "answer";
  answer.innerHTML = renderMarkdown(content);
  body.appendChild(answer);

  wrapper.append(head, body);
  return wrapper;
}

/** A user's question, with an Edit button that swaps it for an inline editor. */
function renderUserMessage(message) {
  const wrapper = document.createElement("div");
  wrapper.className = "msg user";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.content;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  if (message.dataset) {
    const dataset = document.createElement("span");
    dataset.textContent = `on ${message.dataset}`;
    meta.appendChild(dataset);
  }

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "edit-btn";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => {
    if (state.busy) return;
    wrapper.replaceChildren(renderEditor(message, () => wrapper.replaceChildren(bubble, meta)));
    wrapper.querySelector("textarea").focus();
  });
  meta.appendChild(editButton);

  wrapper.append(bubble, meta);
  return wrapper;
}

function renderEditor(message, closeEditor) {
  const editor = document.createElement("form");
  editor.className = "message-editor";

  const textarea = document.createElement("textarea");
  textarea.value = message.content;
  textarea.maxLength = 4000;
  textarea.rows = Math.min(8, Math.max(2, message.content.split("\n").length));
  editor.appendChild(textarea);

  if (state.messages[state.messages.length - 1] !== message) {
    const hint = document.createElement("div");
    hint.className = "edit-note";
    hint.textContent = "Sending replaces this question and everything after it.";
    editor.appendChild(hint);
  }

  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", closeEditor);
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn btn-primary";
  send.textContent = "Send";
  actions.append(cancel, send);
  editor.appendChild(actions);

  editor.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || text === message.content) {
      closeEditor();
      return;
    }
    submitEdit(message, text);
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEditor();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      editor.requestSubmit();
    }
  });
  return editor;
}

function renderAllMessages() {
  $chatMessages.querySelectorAll(".msg").forEach((element) => element.remove());
  cellCount = 0;
  state.messages.forEach(renderMessage);
  updateEmptyState();
  scrollToBottom();
}

/** A placeholder card shown while the backend writes and runs code. */
function showThinking() {
  const card = document.createElement("div");
  card.className = "msg bot thinking";
  card.setAttribute("aria-live", "polite");
  card.innerHTML = `
    <div class="bot-head"><div class="bot-avatar">${ICONS.bot}</div><span class="bot-name">AI Report Analyst</span></div>
    <div class="bot-body">
      <span class="thinking-label">Writing and running code…</span>
      <div class="shimmer"></div><div class="shimmer"></div><div class="shimmer"></div>
    </div>`;
  $chatMessages.appendChild(card);
  scrollToBottom();
  return card;
}

function createTextBlock(className, text) {
  const block = document.createElement("pre");
  block.className = className;
  block.textContent = text;
  return block;
}

function renderImageOutput(output) {
  const image = document.createElement("img");
  image.className = "cell-image";
  image.src = `data:image/png;base64,${output.image}`;
  image.alt = output.alt || "Chart";
  image.addEventListener("load", scrollToBottom);
  return image;
}

/**
 * Rebuilds a Pandas HTML table from an allow-list of tags and attributes, so
 * values from the dataset can never run as markup in the page.
 */
function copyTableNode(source) {
  const copy = document.createElement(source.tagName);
  ["rowspan", "colspan"].forEach((name) => {
    if (source.hasAttribute(name)) copy.setAttribute(name, source.getAttribute(name));
  });
  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      copy.appendChild(document.createTextNode(child.textContent));
    } else if (["THEAD", "TBODY", "TR", "TH", "TD"].includes(child.tagName)) {
      copy.appendChild(copyTableNode(child));
    }
  });
  return copy;
}

function renderTableOutput(output) {
  const parsed = new DOMParser().parseFromString(output.html, "text/html");
  const table = parsed.querySelector("table");
  if (!table) return createTextBlock("cell-text", output.text);

  const container = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.className = "cell-table";
  scroller.appendChild(copyTableNode(table));
  container.appendChild(scroller);

  const dimensions = parsed.querySelector("p");
  if (dimensions) {
    const caption = document.createElement("div");
    caption.className = "cell-note";
    caption.style.marginTop = "6px";
    caption.textContent = dimensions.textContent;
    container.appendChild(caption);
  }
  return container;
}

function renderChartOutput(output) {
  const spec = output.chart;
  if (!spec || !Array.isArray(spec.points) || !spec.points.length) {
    return createTextBlock("cell-text", output.text || "Chart data is unavailable.");
  }

  const width = 760;
  const height = 380;
  const margin = { top: 36, right: 24, bottom: 72, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const points = spec.points.slice(0, 100).filter((point) => Number.isFinite(Number(point.y)));
  if (!points.length) return createTextBlock("cell-text", "Chart has no numeric values to display.");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", spec.title || "Data chart");
  const add = (tag, attrs = {}, text = "") => {
    const el = document.createElementNS(svg.namespaceURI, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    if (text) el.textContent = text;
    svg.appendChild(el);
    return el;
  };
  const title = add("text", { x: width / 2, y: 22, class: "chart-title", "text-anchor": "middle" }, spec.title || "");
  title.setAttribute("aria-hidden", "true");

  let minY = Math.min(0, ...points.map((p) => Number(p.y)));
  let maxY = Math.max(0, ...points.map((p) => Number(p.y)));
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const yPad = (maxY - minY) * 0.08;
  minY -= yPad;
  maxY += yPad;
  const yPos = (value) => margin.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;

  for (let tick = 0; tick <= 4; tick++) {
    const value = minY + (maxY - minY) * tick / 4;
    const y = yPos(value);
    add("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "chart-grid" });
    add("text", { x: margin.left - 8, y: y + 4, class: "chart-tick", "text-anchor": "end" },
      Number(value.toPrecision(4)).toLocaleString());
  }
  add("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + plotHeight, class: "chart-axis" });
  add("line", { x1: margin.left, x2: width - margin.right, y1: margin.top + plotHeight, y2: margin.top + plotHeight, class: "chart-axis" });

  const categories = [...new Set(points.map((p) => String(p.x)))];
  const numericX = points.every((p) => typeof p.x === "number" && Number.isFinite(p.x));
  const xPos = (point, index) => {
    if (numericX && spec.kind !== "bar") {
      const xs = points.map((p) => p.x);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      return margin.left + (maxX === minX ? .5 : (point.x - minX) / (maxX - minX)) * plotWidth;
    }
    const categoryIndex = categories.indexOf(String(point.x));
    return margin.left + (categoryIndex + .5) * plotWidth / categories.length;
  };
  const labelEvery = Math.max(1, Math.ceil(categories.length / 12));
  categories.forEach((label, index) => {
    if (index % labelEvery) return;
    const x = margin.left + (index + .5) * plotWidth / categories.length;
    add("text", { x, y: margin.top + plotHeight + 19, class: "chart-tick chart-x-tick", "text-anchor": "end",
      transform: `rotate(-32 ${x} ${margin.top + plotHeight + 19})` }, label.slice(0, 28));
  });

  const seriesNames = [...new Set(points.map((p) => p.series || "Value"))];
  const colors = ["#4f46e5", "#10b981", "#f59e0b", "#ec4899", "#0ea5e9", "#8b5cf6"];
  if (spec.kind === "bar") {
    const groupWidth = plotWidth / categories.length * .72;
    const barWidth = groupWidth / seriesNames.length;
    points.forEach((point) => {
      const categoryIndex = categories.indexOf(String(point.x));
      const seriesIndex = seriesNames.indexOf(point.series || "Value");
      const x = margin.left + categoryIndex * plotWidth / categories.length +
        (plotWidth / categories.length - groupWidth) / 2 + seriesIndex * barWidth;
      const y = yPos(Number(point.y));
      add("rect", { x, y: Math.min(y, yPos(0)), width: Math.max(1, barWidth - 2),
        height: Math.max(1, Math.abs(yPos(0) - y)), fill: colors[seriesIndex % colors.length], rx: 3 });
    });
  } else {
    seriesNames.forEach((name, seriesIndex) => {
      const set = points.map((point, index) => ({ point, index }))
        .filter(({ point }) => (point.series || "Value") === name)
        .sort((a, b) => numericX ? a.point.x - b.point.x : a.index - b.index);
      if (spec.kind === "line" && set.length > 1) {
        add("polyline", { points: set.map(({ point, index }) => `${xPos(point, index)},${yPos(Number(point.y))}`).join(" "),
          fill: "none", stroke: colors[seriesIndex % colors.length], "stroke-width": 2.5 });
      }
      set.forEach(({ point, index }) => add("circle", { cx: xPos(point, index), cy: yPos(Number(point.y)), r: 4,
        fill: colors[seriesIndex % colors.length] }));
    });
  }

  if (seriesNames.length > 1 || (seriesNames.length === 1 && points.some((p) => p.series))) {
    seriesNames.forEach((name, index) => {
      const x = margin.left + index * 130;
      add("circle", { cx: x + 5, cy: height - 13, r: 5, fill: colors[index % colors.length] });
      add("text", { x: x + 15, y: height - 9, class: "chart-legend" }, name.slice(0, 24));
    });
  }
  add("text", { x: margin.left + plotWidth / 2, y: height - 2, class: "chart-axis-label", "text-anchor": "middle" }, spec.x_label || "");
  const yLabel = add("text", { x: 16, y: margin.top + plotHeight / 2, class: "chart-axis-label", "text-anchor": "middle" }, spec.y_label || "");
  yLabel.setAttribute("transform", `rotate(-90 16 ${margin.top + plotHeight / 2})`);

  const container = document.createElement("div");
  container.className = "cell-chart";
  container.appendChild(svg);
  return container;
}

/** Renders one executed cell: collapsible code, then its output, as in a notebook. */
function renderCell(cell) {
  const number = ++cellCount;
  const container = document.createElement("div");
  container.className = "cell";

  const codeBlock = document.createElement("div");
  codeBlock.className = "code-block";
  const head = document.createElement("div");
  head.className = "code-head";
  head.innerHTML = `<span class="cell-label">In [${number}]:</span><span>python</span><span class="spacer"></span>`;

  const code = highlightPython(cell.code);
  code.hidden = true;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "code-btn";
  toggle.textContent = "Show code";
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    code.hidden = !code.hidden;
    toggle.textContent = code.hidden ? "Show code" : "Hide code";
    toggle.setAttribute("aria-expanded", String(!code.hidden));
  });

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "code-btn";
  copy.innerHTML = `${ICONS.copy}<span>Copy</span>`;
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cell.code);
      copy.querySelector("span").textContent = "Copied";
    } catch {
      copy.querySelector("span").textContent = "Copy failed";
    }
    setTimeout(() => { copy.querySelector("span").textContent = "Copy"; }, 1500);
  });

  head.append(toggle, copy);
  codeBlock.append(head, code);
  container.appendChild(codeBlock);

  if (cell.outputs.length || cell.error) {
    const label = document.createElement("div");
    label.className = "out-label";
    label.innerHTML = `<b>Out [${number}]:</b>`;
    container.appendChild(label);
  }

  cell.outputs.forEach((output) => {
    container.appendChild(
      output.type === "table" ? renderTableOutput(output)
        : output.type === "image" ? renderImageOutput(output)
        : output.type === "chart" ? renderChartOutput(output)
          : createTextBlock("cell-text", output.text)
    );
  });

  if (cell.error) container.appendChild(createTextBlock("cell-text cell-error", cell.error));

  if (cell.notice) {
    const notice = document.createElement("div");
    notice.className = "cell-notice";
    notice.innerHTML = ICONS.warn;
    notice.append(cell.notice);
    container.appendChild(notice);
  }
  return container;
}

/** Only the latest answer's code is sent, so follow-ups can build on it without resending older code. */
function toContextContent({ content, cells = [] }, includeCode) {
  if (!includeCode) return content.slice(0, 4000);
  const code = cells.map((cell) => `Code run with run_python:\n${cell.code}`).join("\n\n");
  return (code ? `${code}\n\nExplanation:\n${content}` : content).slice(0, 4000);
}

// ==========================================================
// API Calls
// ==========================================================

async function fetchDatasets() {
  try {
    const res = await fetch(`${BACKEND_URL}/datasets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.datasets || [];
  } catch (err) {
    console.error("Failed to fetch datasets:", err);
    return null; // null signals connection error
  }
}

/** Uploads with XMLHttpRequest, because fetch cannot report upload progress. */
function uploadDataset(file, onProgress) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("collection_name", $collectionNameInput.value.trim());

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/upload-dataset`);
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.upload.addEventListener("load", () => onProgress(1));
    xhr.addEventListener("load", () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.detail || `Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Could not reach the server.")));
    xhr.send(formData);
  });
}

async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function sendChatMessage(replacesId = null) {
  const messages = state.messages
    .filter((message) => message.includeInContext !== false)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-20);
  const lastAnswer = messages.findLast((message) => message.role === "assistant");
  const context = messages.map((message) => ({
    role: message.role,
    content: toContextContent(message, message === lastAnswer),
  }));

  const res = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: context,
      selected_dataset: state.selectedDataset,
      replaces_id: replacesId,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Chat request failed (HTTP ${res.status})`);
  }
  return data;
}

// ==========================================================
// Datasets
// ==========================================================

function renderDatasetList() {
  const query = $datasetSearch.value.trim().toLowerCase();
  const names = state.datasets.filter((name) => name.toLowerCase().includes(query));
  $datasetCount.textContent = state.datasets.length;
  $datasetList.replaceChildren();

  if (!names.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = state.datasetsError ? "Cannot reach the backend."
      : query ? "No collections match your search."
        : "No collections yet. Upload a file below.";
    $datasetList.appendChild(empty);
    return;
  }

  names.forEach((name) => {
    const active = name === state.selectedDataset;
    const card = document.createElement("div");
    card.className = `dataset-card${active ? " active" : ""}`;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "ds-select";
    select.setAttribute("role", "option");
    select.setAttribute("aria-selected", String(active));
    select.innerHTML = `${ICONS.table}<span class="ds-text"><span class="ds-name"></span><span class="ds-meta">MongoDB collection</span></span><span class="ds-action"></span>`;
    select.querySelector(".ds-name").textContent = name;
    select.querySelector(".ds-action").textContent = active ? "In use" : "Use";
    select.title = name;
    select.addEventListener("click", () => selectDataset(name));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ds-delete";
    remove.innerHTML = ICONS.trash;
    remove.title = `Delete ${name} from MongoDB`;
    remove.setAttribute("aria-label", `Delete ${name} from MongoDB`);
    remove.addEventListener("click", () => deleteDataset(name));

    card.append(select, remove);
    $datasetList.appendChild(card);
  });
}

/** Drops the collection from MongoDB, and removes it from this session. Saved chats about it stay. */
async function deleteDataset(name) {
  if (state.busy) return;
  if (!window.confirm(`Permanently delete "${name}" from MongoDB?\n\nAll of its rows will be removed and cannot be recovered. Chat messages about it are kept.`)) return;

  try {
    // A pending save could otherwise select the dataset again after it is deleted.
    await saveQueue;
    const res = await fetch(`${BACKEND_URL}/api/datasets/${encodeURIComponent(name)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);

    state.datasets = state.datasets.filter((dataset) => dataset !== name);
    // The server has already unselected it.
    if (state.selectedDataset === name) state.selectedDataset = null;
    updateDatasetUI();
    addNote(`Deleted **${name}** from MongoDB.`);
  } catch (err) {
    addError(`Could not delete **${name}**: ${err.message}`);
  }
}

/** Shows the selected dataset in the header, the composer, and the sidebar list. */
function updateDatasetUI() {
  const name = state.selectedDataset;
  $datasetPillName.textContent = name || "No dataset selected";
  $datasetPill.classList.toggle("active", Boolean(name));
  $contextChip.textContent = name || "No dataset";
  $contextChip.classList.toggle("active", Boolean(name));
  $composerHint.textContent = name ? "" : "No dataset selected. Pick or upload one in the sidebar so the analyst can run code.";
  renderDatasetList();
}

function selectDataset(name) {
  if (name === state.selectedDataset) return;
  state.selectedDataset = name;
  saveSelectedDataset();
  updateDatasetUI();
  addNote(`Selected **${name}** from MongoDB. Ask what you want to analyze.`);

  // Close sidebar on mobile after selection
  if (window.innerWidth <= 768) {
    $sidebar.classList.remove("open");
  }
}

// ==========================================================
// Event Handlers
// ==========================================================

// -- Sidebar toggle --
$toggleSidebar.addEventListener("click", () => {
  $sidebar.classList.toggle("open");
});

// -- Theme toggle --
$themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
});

// -- Dataset search --
$datasetSearch.addEventListener("input", renderDatasetList);

// -- Suggestions --
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    $chatInput.value = button.dataset.prompt;
    autoResizeInput();
    if (state.selectedDataset && !state.busy) {
      $chatForm.requestSubmit();
    } else {
      $chatInput.focus();
    }
  });
});

// -- File choice --
function chooseFile(file) {
  $collectionNameInput.value = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120) || "dataset";
  $fileName.textContent = file.name;
  $fileDrop.classList.add("has-file");
  $uploadBtn.disabled = false;
}

$fileInput.addEventListener("change", () => {
  const file = $fileInput.files[0];
  if (file) chooseFile(file);
});

// -- Drag & drop --
$fileDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  $fileDrop.classList.add("dragover");
});
$fileDrop.addEventListener("dragleave", () => {
  $fileDrop.classList.remove("dragover");
});
$fileDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  $fileDrop.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) {
    // Validate extension
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls"].includes(ext)) {
      addError("Please upload a **.csv**, **.xlsx**, or **.xls** file.");
      return;
    }
    $fileInput.files = e.dataTransfer.files;
    chooseFile(file);
  }
});

function setUploadProgress(fraction) {
  const sent = fraction >= 1;
  $uploadProgress.classList.toggle("processing", sent);
  $uploadStatus.textContent = sent ? "Storing in MongoDB…" : "Uploading…";
  $uploadPercent.textContent = sent ? "" : `${Math.round(fraction * 100)}%`;
  $uploadBar.style.width = `${Math.round(fraction * 100)}%`;
}

// -- Upload button --
$uploadBtn.addEventListener("click", async () => {
  const file = $fileInput.files[0];
  if (!file) return;

  $uploadBtn.disabled = true;
  setUploadProgress(0);
  $uploadProgress.classList.remove("hidden");

  try {
    const result = await uploadDataset(file, setUploadProgress);
    const dsName = result.dataset_name;

    state.selectedDataset = dsName;
    saveSelectedDataset();
    addNote(
      `Uploaded **${dsName}**: ${result.rows} rows stored in \`${result.database}\` (dataset ID \`${result.dataset_id}\`). Ask what you want to analyze.`
    );

    // Refresh dataset list
    const datasets = await fetchDatasets();
    if (datasets) {
      state.datasets = datasets;
      state.datasetsError = false;
    }
    updateDatasetUI();

    // Reset upload UI
    $fileInput.value = "";
    $collectionNameInput.value = "";
    $fileName.innerHTML = FILE_DROP_TEXT;
    $fileDrop.classList.remove("has-file");
  } catch (err) {
    addError(`Upload failed: ${err.message}`);
    $uploadBtn.disabled = false;
  } finally {
    $uploadProgress.classList.add("hidden");
    if (!$fileInput.files[0]) $uploadBtn.disabled = true;
  }
});

// -- Chat input --
$chatInput.addEventListener("input", autoResizeInput);
$chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $chatForm.requestSubmit();
  }
});

// -- Chat form submit --
$chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $chatInput.value.trim();
  if (!text || state.busy) return;

  $chatInput.value = "";
  autoResizeInput();
  setBusy(true);

  try {
    await sendQuestion(text);
  } catch (err) {
    addError(err.message);
  } finally {
    setBusy(false);
  }
});

function setBusy(busy) {
  state.busy = busy;
  $chatInput.disabled = busy;
  $sendBtn.disabled = busy;
  if (!busy) $chatInput.focus();
}

async function sendQuestion(text, replacesId = null) {
  const question = addMessage("user", text, true, [], { dataset: state.selectedDataset });
  const thinking = showThinking();
  let data;
  try {
    data = await sendChatMessage(replacesId);
  } finally {
    thinking.remove();
  }
  const { reply, cells, turn_id: turnId } = data;
  question.historyId = turnId;
  addMessage("assistant", reply, true, cells).historyId = turnId;
}

/**
 * Reruns an edited question on the dataset it was asked about, and replaces it and
 * what followed. The old messages come back if the new question fails.
 */
async function submitEdit(message, text) {
  const previousMessages = state.messages;
  const previousDataset = state.selectedDataset;
  const index = previousMessages.indexOf(message);
  const replacesId = previousMessages.slice(index).find((item) => item.historyId)?.historyId ?? null;

  state.messages = previousMessages.slice(0, index);
  if (message.dataset) state.selectedDataset = message.dataset;
  renderAllMessages();
  setBusy(true);

  try {
    await saveQueue;
    await sendQuestion(text, replacesId);
    if (state.selectedDataset !== previousDataset) {
      saveSelectedDataset();
      updateDatasetUI();
    }
  } catch (err) {
    state.messages = previousMessages;
    state.selectedDataset = previousDataset;
    renderAllMessages();
    addError(`Your edit was not applied: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

// Let keyboard users scroll chat history. Arrow keys stay with the message box for moving the caret.
document.addEventListener("keydown", (e) => {
  const activeElement = document.activeElement;
  const inInput = activeElement === $chatInput;
  if (!inInput && activeElement !== $chatMessages) return;

  let scrollDelta = 0;
  switch (e.key) {
    case "ArrowDown":
      if (inInput) return;
      scrollDelta = 48;
      break;
    case "ArrowUp":
      if (inInput) return;
      scrollDelta = -48;
      break;
    case "PageDown":
      scrollDelta = $chatMessages.clientHeight * 0.85;
      break;
    case "PageUp":
      scrollDelta = -$chatMessages.clientHeight * 0.85;
      break;
    default:
      return;
  }

  e.preventDefault();
  $chatMessages.scrollBy({ top: scrollDelta });
});

// -- Clear chat history --
$clearChatBtn.addEventListener("click", async () => {
  if (!window.confirm("Permanently delete the whole chat history?")) return;
  try {
    await saveQueue;
    const res = await fetch(`${BACKEND_URL}/api/chat/history`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.messages = [];
    renderAllMessages();
  } catch (err) {
    addError(`Could not clear the chat history: ${err.message}`);
  }
});

// ==========================================================
// Initialization
// ==========================================================

async function init() {
  await restoreConversation();

  // Check backend health
  const online = await checkBackendHealth();
  $connectionStatus.classList.toggle("online", online);
  $connectionStatus.classList.toggle("offline", !online);
  $connectionStatus.querySelector(".status-text").textContent = online ? "Connected" : "Offline";

  // Fetch datasets
  const datasets = await fetchDatasets();

  if (datasets === null) {
    state.datasetsError = true;
    $emptyText.textContent = `Cannot connect to the backend. Make sure the FastAPI server is running at ${BACKEND_URL}.`;
    updateDatasetUI();
    return;
  }

  state.datasets = datasets;
  if (!datasets.length) {
    $emptyText.textContent = "There are no datasets in MongoDB yet. Upload a CSV or Excel file in the sidebar to start.";
  }

  if (!state.selectedDataset || !datasets.includes(state.selectedDataset)) {
    state.selectedDataset = null;
    saveSelectedDataset();
  }
  updateDatasetUI();
}

// Start the app
init();
