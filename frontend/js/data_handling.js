// ==========================================================
// AI Report Analyst – Data handling: list, upload and delete datasets
// Uses the state and DOM refs set up in data_analysis.js, which loads first.
// ==========================================================

// ==========================================================
// API Calls
// ==========================================================

async function fetchDatasets() {
  try {
    const res = await apiFetch(`${BACKEND_URL}/datasets`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.database = data.database || "";
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
      if (xhr.status === 401) return redirectToLogin();
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.detail || `Upload failed (HTTP ${xhr.status})`));
    });
    xhr.addEventListener("error", () => reject(new Error("Could not reach the server.")));
    xhr.send(formData);
  });
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
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", String(active));
    card.title = name;
    card.innerHTML = `
      <div class="ds-top">
        <div class="ds-id">
          <span class="ds-icon">${icon(active ? "table_chart" : "table_view")}</span>
          <span class="ds-text"><span class="ds-name"></span><span class="ds-meta">MongoDB collection</span></span>
        </div>
      </div>
      <div class="ds-bottom">
        <span class="ds-status">${active ? "Active schema" : "Ready"}</span>
        <button type="button" class="ds-action">${active ? "In use" : "Use"}</button>
      </div>`;
    card.querySelector(".ds-name").textContent = name;
    card.addEventListener("click", () => selectDataset(name));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ds-delete";
    remove.innerHTML = icon("delete");
    remove.title = `Delete ${name} from MongoDB`;
    remove.setAttribute("aria-label", `Delete ${name} from MongoDB`);
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDataset(name);
    });
    card.querySelector(".ds-top").appendChild(remove);

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
    const res = await apiFetch(`${BACKEND_URL}/api/datasets/${encodeURIComponent(name)}`, { method: "DELETE" });
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

/** Shows the selected dataset in the top bar, the composer, and the datasets panel. */
function updateDatasetUI() {
  const name = state.selectedDataset;
  $datasetPillName.textContent = name || "No dataset selected";
  $datasetPill.classList.toggle("active", Boolean(name));
  $contextChipName.textContent = name || "No dataset";
  $contextChip.classList.toggle("active", Boolean(name));
  $composerHint.textContent = name ? "" : "No dataset selected. Pick or upload one in the Datasets panel so the analyst can run code.";
  $databaseName.textContent = state.database ? `Database: ${state.database}` : "MongoDB";
  $datasetSummary.textContent = state.datasetsError ? "Offline"
    : `${state.datasets.length} ${state.datasets.length === 1 ? "collection" : "collections"}`;
  renderDatasetList();
}

function selectDataset(name) {
  if (name === state.selectedDataset) return;
  if (!state.activeChatId) startNewChat();
  state.selectedDataset = name;
  saveSelectedDataset();
  updateDatasetUI();
  addNote(`Selected **${name}** from MongoDB. Ask what you want to analyze.`);

  // Close the floating panel on narrow screens after selection
  if (NARROW_PANEL.matches) setDatasetsOpen(false);
}

async function refreshDatasets() {
  const datasets = await fetchDatasets();
  state.datasetsError = datasets === null;
  if (datasets) state.datasets = datasets;
  updateDatasetUI();
}
// ==========================================================
// Event Handlers
// ==========================================================

// -- Dataset search --
$datasetSearch.addEventListener("input", renderDatasetList);
$refreshDatasets.addEventListener("click", refreshDatasets);

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

    if (!state.activeChatId) startNewChat();
    state.selectedDataset = dsName;
    saveSelectedDataset();
    addNote(
      `Uploaded **${dsName}**: ${result.rows} rows stored in \`${result.database}\` (dataset ID \`${result.dataset_id}\`). Ask what you want to analyze.`
    );

    // Refresh dataset list
    await refreshDatasets();

    // Reset upload UI
    $fileInput.value = "";
    $collectionNameInput.value = "";
    $fileName.textContent = FILE_DROP_TEXT;
    $fileDrop.classList.remove("has-file");
  } catch (err) {
    addError(`Upload failed: ${err.message}`);
    $uploadBtn.disabled = false;
  } finally {
    $uploadProgress.classList.add("hidden");
    if (!$fileInput.files[0]) $uploadBtn.disabled = true;
  }
});
