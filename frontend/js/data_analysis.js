// ==========================================================
// AI Report Analyst – Data analysis: chat, EDA and charts
// ==========================================================

let saveQueue = Promise.resolve();
let cellCount = 0;

// ---- State ----
const state = {
  messages: [],
  datasets: [],
  datasetsError: false,
  database: "",
  selectedDataset: null,
  activeChatId: null,
  chats: [],
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
const $contextChipName = document.getElementById("contextChipName");
const $attachBtn       = document.getElementById("attachBtn");
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
const $themeToggle     = document.getElementById("themeToggle");
const $sidebar         = document.getElementById("sidebar");
const $collapseSidebar = document.getElementById("collapseSidebar");
const $openSidebar     = document.getElementById("openSidebar");
const $datasetsPanel   = document.getElementById("datasetsPanel");
const $toggleDatasets  = document.getElementById("toggleDatasets");
const $closeDatasets   = document.getElementById("closeDatasets");
const $refreshDatasets = document.getElementById("refreshDatasets");
const $databaseName    = document.getElementById("databaseName");
const $datasetSummary  = document.getElementById("datasetSummary");
const $scrim           = document.getElementById("scrim");
const $connectionStatus = document.getElementById("connectionStatus");
const $clearChatBtn    = document.getElementById("clearChatBtn");
const $recentList      = document.getElementById("recentList");
const $chatSearch      = document.getElementById("chatSearch");
const $newChatBtn      = document.getElementById("newChatBtn");
const $chatTitle       = document.getElementById("chatTitle");
const $chatTag         = document.getElementById("chatTag");

const FILE_DROP_TEXT = $fileName.textContent;
const NARROW_PANEL = matchMedia("(max-width: 1100px)");
const NARROW_SIDEBAR = matchMedia("(max-width: 768px)");

/** A Material Symbols icon, by its ligature name. */
const icon = (name) => `<span class="ms" aria-hidden="true">${name}</span>`;

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

/** A button that copies text, and briefly says whether it worked. */
function copyButton(className, getText, label = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = "Copy";
  button.innerHTML = `${icon("content_copy")}${label ? `<span>${label}</span>` : ""}`;
  const glyph = button.querySelector(".ms");
  const text = button.querySelector("span:not(.ms)");
  button.addEventListener("click", async () => {
    let copied = true;
    try {
      await navigator.clipboard.writeText(getText());
    } catch {
      copied = false;
    }
    glyph.textContent = copied ? "check" : "error";
    if (text) text.textContent = copied ? "Copied" : "Copy failed";
    setTimeout(() => {
      glyph.textContent = "content_copy";
      if (text) text.textContent = label;
    }, 1500);
  });
  return button;
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
      const res = await apiFetch(`${BACKEND_URL}${path}`, {
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

// ==========================================================
// Recent chats
// ==========================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days between the date and today: 0 for today, 1 for yesterday. */
function daysAgo(date) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((startOfToday - date.getTime()) / DAY_MS));
}

function chatGroup(date) {
  if (!date) return "Older";
  const days = daysAgo(date);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Previous 7 days" : "Older";
}

function relativeTime(date) {
  const days = daysAgo(date);
  if (days === 0) {
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
  }
  if (days === 1) return "Yesterday";
  if (days <= 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderRecentCard(chat, date) {
  const active = state.activeChatId === chat.chat_id;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `recent-card${active ? " active" : ""}`;
  if (active) button.setAttribute("aria-current", "true");

  const title = document.createElement("span");
  title.className = "recent-title";
  title.textContent = chat.title || "Untitled chat";
  title.title = title.textContent;

  const meta = document.createElement("span");
  meta.className = "recent-meta";
  const parts = [
    chat.dataset && ["recent-dataset", chat.dataset],
    ["", `${chat.item_count} ${chat.item_count === 1 ? "item" : "items"}`],
    date && ["", relativeTime(date)],
  ].filter(Boolean);
  parts.forEach(([className, text], index) => {
    if (index) meta.append(Object.assign(document.createElement("span"), { textContent: "•" }));
    meta.append(Object.assign(document.createElement("span"), { className, textContent: text }));
  });

  button.append(title, meta);
  button.addEventListener("click", () => openChat(chat));
  return button;
}

/** Lists saved chats under Today, Yesterday, Previous 7 days and Older, filtered by the search box. */
function renderRecentChats() {
  $recentList.replaceChildren();
  const query = $chatSearch.value.trim().toLowerCase();
  const chats = state.chats.filter((chat) =>
    `${chat.title || ""} ${chat.dataset || ""}`.toLowerCase().includes(query));

  if (!chats.length) {
    const empty = document.createElement("div");
    empty.className = "recent-empty";
    empty.textContent = query ? "No chats match your search." : "No saved chats yet. Start a new analysis to begin.";
    $recentList.appendChild(empty);
    return;
  }

  const groups = new Map();
  chats.forEach((chat) => {
    const date = chat.updated_at ? new Date(chat.updated_at) : null;
    const name = chatGroup(date);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(renderRecentCard(chat, date));
  });

  groups.forEach((cards, name) => {
    const group = document.createElement("div");
    const head = document.createElement("div");
    head.className = "recent-group-head";
    head.append(
      Object.assign(document.createElement("span"), { textContent: name }),
      Object.assign(document.createElement("span"), { textContent: cards.length }),
    );
    group.append(head, ...cards);
    $recentList.appendChild(group);
  });
}

/** Shows the open chat's title in the top bar. */
function updateChatHeader() {
  const chat = state.chats.find((item) => item.chat_id === state.activeChatId);
  const firstQuestion = state.messages.find((message) => message.role === "user")?.content;
  const title = chat?.title || firstQuestion || "New analysis";
  $chatTitle.textContent = title;
  $chatTitle.title = title;
  document.title = state.messages.length ? `${title} · AI Report Analyst` : "AI Report Analyst";
  $chatTag.classList.toggle("hidden", !chat);
  $chatTag.textContent = chat ? `#${chat.chat_id.slice(0, 8)}` : "";
}

async function loadRecentChats() {
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/chat/history`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.chats = (await res.json()).chats || [];
  } catch (error) {
    state.chats = [];
    console.warn("Could not load recent chats:", error);
  }
  renderRecentChats();
  updateChatHeader();
}

async function openChat(chat) {
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/chat/history/${encodeURIComponent(chat.chat_id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const history = await res.json();
    state.activeChatId = chat.chat_id;
    state.messages = history.items.flatMap(historyItemToMessages);
    state.selectedDataset = chat.dataset || null;
    renderAllMessages();
    renderRecentChats();
    updateDatasetUI();
    if (NARROW_SIDEBAR.matches) setSidebarOpen(false);
  } catch (error) {
    console.warn("Could not open the selected chat:", error);
  }
}

function startNewChat() {
  state.activeChatId = crypto.randomUUID();
  state.messages = [];
  state.selectedDataset = null;
  renderAllMessages();
  renderRecentChats();
  updateDatasetUI();
  if (NARROW_SIDEBAR.matches) setSidebarOpen(false);
  $chatInput.focus();
}

async function restoreConversation() {
  await loadRecentChats();
  return true;
}

// ==========================================================
// Messages
// ==========================================================

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
  if (!state.activeChatId) startNewChat();
  const message = addMessage("assistant", content, true, [], { note: true });
  queueSave("/api/chat/notes", "POST", { content, chat_id: state.activeChatId }, ({ id }) => {
    message.historyId = id;
    loadRecentChats();
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
  wrapper.innerHTML = icon("check_circle");
  const text = document.createElement("div");
  text.innerHTML = renderMarkdown(content);
  wrapper.appendChild(text);
  return wrapper;
}

/** An answer: a header with run details, the explanation, then each executed cell. */
function renderBotMessage({ content, cells = [], error, seconds }) {
  const wrapper = document.createElement("div");
  wrapper.className = `msg bot${error ? " error" : ""}`;

  const head = document.createElement("div");
  head.className = "bot-head";
  const id = document.createElement("div");
  id.className = "bot-id";
  id.innerHTML = `<div class="bot-avatar">${icon("smart_toy")}</div><span class="bot-name">AI Report Analyst</span>`;
  if (cells.length || error) {
    const badge = document.createElement("span");
    badge.className = "bot-badge";
    badge.textContent = error ? "Error"
      : [`${cells.length} ${cells.length === 1 ? "cell" : "cells"} ran`, seconds && `${seconds.toFixed(1)}s`].filter(Boolean).join(" · ");
    id.appendChild(badge);
  }
  const actions = document.createElement("div");
  actions.className = "bot-actions";
  actions.appendChild(copyButton("icon-btn", () => content));
  head.append(id, actions);

  const answer = document.createElement("div");
  answer.className = "answer";
  answer.innerHTML = renderMarkdown(content);

  wrapper.append(head, answer);
  cells.forEach((cell) => wrapper.appendChild(renderCell(cell)));
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
  editButton.innerHTML = `${icon("edit")}<span>Edit</span>`;
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
  updateChatHeader();
  scrollToBottom();
}

/** An indicator shown while the backend writes and runs code. */
function showThinking() {
  const card = document.createElement("div");
  card.className = "msg thinking";
  card.setAttribute("aria-live", "polite");
  card.innerHTML = `
    <div class="bot-avatar">${icon("psychology")}</div>
    <span class="thinking-label">Analyzing your data…</span>
    <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    <span class="thinking-note">Running Python in the sandbox</span>`;
  $chatMessages.appendChild(card);
  scrollToBottom();
  return card;
}

// ==========================================================
// Notebook cells
// ==========================================================

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

/** Saves a rendered table as a CSV file. */
function downloadTableCsv(table) {
  const quote = (text) => /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  const csv = [...table.querySelectorAll("tr")]
    .map((row) => [...row.children].map((cell) => quote(cell.textContent.trim())).join(","))
    .join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "table.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function renderTableOutput(output) {
  const parsed = new DOMParser().parseFromString(output.html, "text/html");
  const table = parsed.querySelector("table");
  if (!table) return createTextBlock("cell-text", output.text);

  const container = document.createElement("div");
  container.className = "table-card";
  const scroller = document.createElement("div");
  scroller.className = "cell-table";
  const safeTable = copyTableNode(table);
  scroller.appendChild(safeTable);

  const foot = document.createElement("div");
  foot.className = "table-foot";
  const caption = document.createElement("span");
  const dimensions = parsed.querySelector("p");
  const rows = safeTable.querySelectorAll("tbody tr").length;
  caption.textContent = dimensions ? dimensions.textContent : `${rows} ${rows === 1 ? "row" : "rows"}`;
  const download = document.createElement("button");
  download.type = "button";
  download.innerHTML = `${icon("file_download")}CSV`;
  download.addEventListener("click", () => downloadTableCsv(safeTable));
  foot.append(caption, download);

  container.append(scroller, foot);
  return container;
}

function renderChartOutput(output) {
  const spec = output.chart;
  if (!spec || !Array.isArray(spec.points) || !spec.points.length) {
    return createTextBlock("cell-text", output.text || "Chart data is unavailable.");
  }

  const width = 760;
  const height = 350;
  const margin = { top: 12, right: 24, bottom: 72, left: 68 };
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

  let minY = Math.min(0, ...points.map((p) => Number(p.y)));
  let maxY = Math.max(0, ...points.map((p) => Number(p.y)));
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const yPad = (maxY - minY) * 0.08;
  if (minY < 0) minY -= yPad;
  maxY += yPad;
  const yPos = (value) => margin.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;

  for (let tick = 0; tick <= 4; tick++) {
    const value = minY + (maxY - minY) * tick / 4;
    const y = yPos(value);
    add("line", { x1: margin.left, x2: width - margin.right, y1: y, y2: y, class: "chart-grid" });
    add("text", { x: margin.left - 8, y: y + 4, class: "chart-tick", "text-anchor": "end" },
      Number(value.toPrecision(4)).toLocaleString());
  }
  add("line", { x1: margin.left, x2: width - margin.right, y1: margin.top + plotHeight, y2: margin.top + plotHeight, class: "chart-axis" });

  const categories = [...new Set(points.map((p) => String(p.x)))];
  const numericX = points.every((p) => typeof p.x === "number" && Number.isFinite(p.x));
  const xPos = (point) => {
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
  const colors = ["#4f46e5", "#006c49", "#885500", "#6366f1", "#0ea5e9", "#ba1a1a"];
  if (spec.kind === "bar") {
    const groupWidth = plotWidth / categories.length * .6;
    const barWidth = groupWidth / seriesNames.length;
    points.forEach((point) => {
      const categoryIndex = categories.indexOf(String(point.x));
      const seriesIndex = seriesNames.indexOf(point.series || "Value");
      const x = margin.left + categoryIndex * plotWidth / categories.length +
        (plotWidth / categories.length - groupWidth) / 2 + seriesIndex * barWidth;
      const y = yPos(Number(point.y));
      add("rect", { x, y: Math.min(y, yPos(0)), width: Math.max(1, barWidth - 2),
        height: Math.max(1, Math.abs(yPos(0) - y)), fill: colors[seriesIndex % colors.length],
        rx: Math.min(6, barWidth / 4) });
    });
  } else {
    seriesNames.forEach((name, seriesIndex) => {
      const set = points.map((point, index) => ({ point, index }))
        .filter(({ point }) => (point.series || "Value") === name)
        .sort((a, b) => numericX ? a.point.x - b.point.x : a.index - b.index);
      if (spec.kind === "line" && set.length > 1) {
        add("polyline", { points: set.map(({ point }) => `${xPos(point)},${yPos(Number(point.y))}`).join(" "),
          fill: "none", stroke: colors[seriesIndex % colors.length], "stroke-width": 2.5 });
      }
      set.forEach(({ point }) => add("circle", { cx: xPos(point), cy: yPos(Number(point.y)), r: 4,
        fill: colors[seriesIndex % colors.length] }));
    });
  }

  if (seriesNames.length > 1 || (seriesNames.length === 1 && points.some((p) => p.series))) {
    seriesNames.forEach((name, index) => {
      const x = margin.left + index * 130;
      add("rect", { x, y: height - 18, width: 10, height: 10, rx: 2, fill: colors[index % colors.length] });
      add("text", { x: x + 15, y: height - 9, class: "chart-legend" }, name.slice(0, 24));
    });
  }
  add("text", { x: margin.left + plotWidth / 2, y: height - 2, class: "chart-axis-label", "text-anchor": "middle" }, spec.x_label || "");
  const yLabel = add("text", { x: 16, y: margin.top + plotHeight / 2, class: "chart-axis-label", "text-anchor": "middle" }, spec.y_label || "");
  yLabel.setAttribute("transform", `rotate(-90 16 ${margin.top + plotHeight / 2})`);

  const container = document.createElement("div");
  container.className = "cell-chart";
  if (spec.title) {
    const head = document.createElement("div");
    head.className = "chart-head";
    const text = document.createElement("div");
    text.innerHTML = "<h4></h4><p></p>";
    text.querySelector("h4").textContent = spec.title;
    text.querySelector("p").textContent = [spec.y_label, spec.x_label].filter(Boolean).join(" by ");
    head.appendChild(text);
    container.appendChild(head);
  }
  const scroller = document.createElement("div");
  scroller.className = "chart-scroll";
  scroller.appendChild(svg);
  container.appendChild(scroller);
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
  head.innerHTML = `<span class="cell-label">In [${number}]:</span><span>Python (pandas)</span><span class="spacer"></span>`;

  const code = highlightPython(cell.code);
  code.hidden = true;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "code-btn";
  const updateToggle = () => {
    toggle.innerHTML = code.hidden
      ? `${icon("unfold_more")}<span>Show code</span>`
      : `${icon("unfold_less")}<span>Hide code</span>`;
    toggle.setAttribute("aria-expanded", String(!code.hidden));
  };
  updateToggle();
  toggle.addEventListener("click", () => {
    code.hidden = !code.hidden;
    updateToggle();
  });

  head.append(copyButton("code-btn", () => cell.code, "Copy"), toggle);
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
    notice.innerHTML = `${icon("warning")}<div><b>Notice:</b> </div>`;
    notice.lastChild.append(cell.notice);
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

async function checkBackendHealth() {
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/health`);
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

  const res = await apiFetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: context,
      selected_dataset: state.selectedDataset,
      replaces_id: replacesId,
      chat_id: state.activeChatId || (state.activeChatId = crypto.randomUUID()),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Chat request failed (HTTP ${res.status})`);
  }
  return data;
}

// ==========================================================
// Event Handlers
// ==========================================================

// -- Side panels --
/** On narrow screens a side panel floats over the chat, with a scrim behind it. */
function updateScrim() {
  const floating = (NARROW_SIDEBAR.matches && $sidebar.classList.contains("open"))
    || (NARROW_PANEL.matches && $datasetsPanel.classList.contains("open"));
  $scrim.hidden = !floating;
}

function setSidebarOpen(open) {
  $sidebar.classList.toggle("open", open);
  updateScrim();
}

function setDatasetsOpen(open) {
  $datasetsPanel.classList.toggle("open", open);
  $toggleDatasets.setAttribute("aria-expanded", String(open));
  updateScrim();
}

$collapseSidebar.addEventListener("click", () => setSidebarOpen(false));
$openSidebar.addEventListener("click", () => setSidebarOpen(true));
$toggleDatasets.addEventListener("click", () => setDatasetsOpen(!$datasetsPanel.classList.contains("open")));
$closeDatasets.addEventListener("click", () => setDatasetsOpen(false));
$datasetPill.addEventListener("click", () => {
  setDatasetsOpen(true);
  $datasetSearch.focus();
});
$attachBtn.addEventListener("click", () => {
  setDatasetsOpen(true);
  $fileInput.click();
});
$scrim.addEventListener("click", () => {
  if (NARROW_SIDEBAR.matches) setSidebarOpen(false);
  if (NARROW_PANEL.matches) setDatasetsOpen(false);
});
$chatSearch.addEventListener("input", renderRecentChats);

// Start with the floating panels closed on narrow screens.
if (NARROW_SIDEBAR.matches) setSidebarOpen(false);
if (NARROW_PANEL.matches) setDatasetsOpen(false);
NARROW_SIDEBAR.addEventListener("change", updateScrim);
NARROW_PANEL.addEventListener("change", updateScrim);

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

// -- Chat input --
$chatInput.addEventListener("input", autoResizeInput);
$chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $chatForm.requestSubmit();
  }
});

$newChatBtn.addEventListener("click", startNewChat);

// Ctrl+K (Cmd+K on a Mac) starts a new analysis.
if (/Mac|iPhone|iPad/.test(navigator.platform)) document.getElementById("newChatKey").textContent = "⌘K";
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (!state.busy) startNewChat();
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
  const started = performance.now();
  let data;
  try {
    data = await sendChatMessage(replacesId);
  } finally {
    thinking.remove();
  }
  const { reply, cells, turn_id: turnId } = data;
  question.historyId = turnId;
  const seconds = (performance.now() - started) / 1000;
  addMessage("assistant", reply, true, cells, { seconds }).historyId = turnId;
  loadRecentChats();
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
    const res = await apiFetch(`${BACKEND_URL}/api/chat/history`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.messages = [];
    state.chats = [];
    state.activeChatId = null;
    renderAllMessages();
    await loadRecentChats();
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
    $emptyText.textContent = "There are no datasets in MongoDB yet. Upload a CSV or Excel file in the Datasets panel to start.";
  }

  if (!state.selectedDataset || !datasets.includes(state.selectedDataset)) {
    state.selectedDataset = null;
    saveSelectedDataset();
  }
  updateDatasetUI();
}

// Start the app once the other feature scripts have loaded
document.addEventListener("DOMContentLoaded", init);
