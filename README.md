# AI Report Analyst

AI Report Analyst is a data analysis bot for data analysts and data scientists. Users ask for what they want in plain language instead of writing code. The bot writes and runs the Pandas code on the selected dataset, shows the output as a Jupyter notebook would, and explains it.

## What the app can do today

- Show the MongoDB collections that are available as datasets.
- Upload `.csv`, `.xlsx`, or `.xls` files and save their rows in MongoDB.
- Select or upload one dataset, then ask for an analysis in chat: `info()`, `describe()`, `head()`, null counts, filtering, grouping, correlations, and similar work.
- Show real output for each request: DataFrames as tables, Matplotlib and Seaborn charts as images, and other values and printed text as a notebook shows them. The code that ran is available under **Show code**.
- Explain each output with the model set in `OPENAI_MODEL`; the default in the code is `gpt-4o-mini`.
- Provide a separate profile API endpoint, which the chat does not use.

It does **not** yet support multi-dataset joins or keeping changes between requests. Every request starts from the original dataset, so a change such as `df = df.dropna()` lasts only for that request. The model can repeat earlier steps from the chat history when a follow-up needs them.

## How the current workflow works

```text
Select a collection or upload a CSV / Excel file
       ↓
User asks a question in chat
       ↓
Backend sends the question and dataset schema to OpenAI
       ↓
The model writes Pandas code and calls the run_python tool
       ↓
The backend runs the code in a separate process on the full dataset
       ↓
The output goes back to the model, which can fix errors or run more code (up to 5 rounds)
       ↓
The UI shows the real output, followed by the model's explanation
```

Numbers in the output come from running the code, not from the model. The explanation is written by the model from that output.

For a large collection, analysis is limited to the first 100,000 rows, and the output says when this happens.

## How generated code is contained

The code is written by an LLM and can be influenced by values inside a dataset, so `backend/sandbox_worker.py` limits what it can do:

- It runs in a separate process with a 30-second limit and without the backend's environment variables, including the API key and `MONGO_URI`.
- Before running, code is checked against an allow-list of imports and a block-list of names and attributes. File readers and writers, `eval()`, `df.query()`, and private attributes are refused.
- While running, a Python audit hook refuses file access, subprocesses, and network connections.

**These are guard rails, not a security boundary.** In-process Python restrictions can be bypassed by a determined attacker, and there is no memory limit. Before other people can use this app, run the worker in a locked-down container with no network access, a read-only filesystem, and CPU and memory limits.

## Project files

```text
backend/
  main.py            FastAPI routes: health, chat, dataset listing, upload, profiling
  database.py        MongoDB connection and collection helpers
  llm.py             .env loading, the OpenAI/LangChain calls, and the tool-calling loop
  analysis.py        Loads a dataset and runs code in a separate process
  sandbox_worker.py  Checks and runs one cell, and formats its output like a notebook
  profiling.py       Schema lookup for chat and Pandas-based profile calculations
  prompts/           The LLM prompt text:
    common.txt         The short prompts, as [sections]. Keep the section names,
                       {dataset!r}, and {schema}
    analysis.txt       Rules for every request when a dataset is selected
    data_overview.txt  Added for tables, numbers, and calculations with Pandas
    visualization.txt  Added for charts

frontend/
  index.html       Page structure and controls
  app.js           Browser behavior, API calls, and chat messages
  styles.css       Page appearance and layout

app/
  config/settings.py   A separate settings definition
  database/mongodb.py  A separate MongoDB connection helper

Dockerfile         Instructions for building the app container
docker-compose.yml Starts the app container
requirements.txt   Python packages installed for this project
pyproject.toml     Basic Python project metadata
```

The active FastAPI app imports its MongoDB code from `backend/database.py`. The files under `app/` define another settings and database connection path, but the current `backend/main.py` does not use them.

## Setup and run locally on Windows

### 1. Start MongoDB

Make sure MongoDB Server is running on your computer. By default, the app connects to `mongodb://localhost:27017/` and uses the database `AI_Report_Database`.

### 2. Configure `.env`

Create or edit a `.env` file in the project root. Set your API key and model there:

```env
OPENAI_API_KEY=your_actual_openai_api_key
OPENAI_MODEL=gpt-4o-mini
MONGO_URI=mongodb://localhost:27017/
MONGO_DB_NAME=AI_Report_Database
```

Keep the real API key private. Do not put it in frontend files or commit `.env` to source control. The key is loaded by the backend when it starts, so restart the backend after changing `.env`.

### 3. Install Python dependencies

Open PowerShell in the project folder and run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### 4. Start the app

```powershell
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000) in a browser. The API's interactive documentation is at [http://localhost:8000/docs](http://localhost:8000/docs).

## Run with Docker Compose

Docker Compose expects a project-root `.env` file because `docker-compose.yml` passes it to the container. Build and start the app with:

```powershell
docker compose up --build
```

The app is available at [http://localhost:8000](http://localhost:8000). If MongoDB is running on the Windows host rather than in Docker, set `MONGO_URI` in `.env` to `mongodb://host.docker.internal:27017/` for the container to reach it. Stop the container with `Ctrl+C`; to run it in the background, use `docker compose up --build -d`.

## API routes

| Route | What it does |
| --- | --- |
| `GET /api/health` | Confirms the FastAPI backend is responding. |
| `GET`, `DELETE /api/chat/history` | Loads the latest 100 saved turns and notes with the selected dataset, or deletes all turns and notes. |
| `POST /api/chat/notes` | Saves an app message, such as a completed upload. |
| `PUT /api/chat/selected-dataset` | Saves the selected dataset. |
| `GET /datasets` | Lists MongoDB collection names and the configured database name. |
| `POST /upload-dataset` | Accepts a CSV or Excel file plus a MongoDB collection name, then inserts the file's rows into MongoDB. |
| `POST /api/datasets/{dataset_name}/profile` | Loads a collection, calculates its Pandas profile, and asks OpenAI to explain that profile. |
| `POST /api/chat` | Answers a chat message, running Pandas code on the selected dataset as needed. Returns the explanation as `reply` and the executed code and outputs as `cells`. |
| `GET /` and other non-API paths | Serves the frontend page. Frontend assets are served under `/static`. |

## What each backend function does

### `backend/main.py`

- **`ChatMessage`** checks that each chat entry has a role (`user` or `assistant`) and non-empty text of at most 4,000 characters.
- **`ChatRequest`** checks that a chat request has between 1 and 20 messages. It can also include the selected dataset name.
- **`ChatResponse`** describes the reply shape returned by the chat API: a `reply` string and a list of executed `cells`.
- **`root()`** handles `GET /api/health` and returns a small “backend is running” message.
- **`chat(request)`** gets the selected dataset's schema and passes it with the chat history and a code-running callback to `generate_reply()`. It turns missing OpenAI configuration into HTTP 503 and provider errors into HTTP 502.
- **`get_datasets()`** calls the MongoDB helper and returns the database name and collection names.
- **`get_dataset_profile(dataset_name)`** calls `profile_dataset()` for the selected collection, then `generate_dataset_overview()` to get an explanation. It returns both the measurements and explanation.
- **`upload_dataset(file, collection_name)`** checks the collection name and file extension, reads CSV or Excel with Pandas, replaces missing values with MongoDB-friendly nulls, and stores the records. It rejects empty files and duplicate collection names.
- **`serve_frontend(full_path)`** returns `frontend/index.html` for browser page requests that do not match an earlier route.

FastAPI's CORS middleware currently allows requests from any origin. That is convenient during local development; a deployed app should restrict this to its actual website origin.

### `backend/database.py`

- **`MONGO_URI`** is the MongoDB connection address. It comes from `.env` or defaults to local MongoDB.
- **`DB_NAME`** is the MongoDB database name. It comes from `MONGO_DB_NAME` or defaults to `AI_Report_Database`.
- **`client` and `db`** create the MongoDB client and select the configured database.
- **`get_database()`** returns the selected database so other backend code can access collections.
- **`get_dataset_names()`** returns collection names, skipping system collections.
- **`insert_dataset(collection_name, records)`** inserts a list of row dictionaries into a MongoDB collection and returns how many rows were inserted.

### `backend/analysis.py`

- **`load_dataframe(dataset_name)`** loads up to 100,000 rows from a collection and returns them with the collection's full row count.
- **`run_code(dataset_name, code)`** starts `sandbox_worker.py` in a temporary folder with a minimal environment, then returns the code, its outputs, any error, and a notice if only part of the dataset was used.

### `backend/sandbox_worker.py`

- **`validate(tree)`** refuses disallowed imports, names, and attributes before code runs.
- **`install_audit_hook(result_path)`** refuses file, process, and network access while code runs.
- **`to_output(value)`** formats a value the way a notebook does: an HTML table for a DataFrame and `repr()` text for anything else.
- **`make_chart(data, kind, title, x_label, y_label, x, y, series)`** converts up to 100 data records into a validated chart specification for bar, line, or scatter charts. It accepts a DataFrame or list of dictionaries. The model is now told to use Matplotlib or Seaborn instead.
- **`load_plotting()`** imports Matplotlib and Seaborn and applies the chart theme. It runs only for cells that appear to plot.
- **`plotted_series(axes)`** reads the plotted bars and labelled lines back from a chart.
- **`check_series_visible(figure)`** refuses a chart when one series is over 50 times smaller than another on the same axis, so the model has to rescale it or use subplots.
- **`describe_plotted_values(figure)`** lists up to 30 plotted values per series, so the model can explain a chart it cannot see.
- **`figure_to_output(figure)`** renders a figure as a PNG for the page, with a text description and the plotted values for the model.
- **`run(code, df, plt, sns)`** runs a cell with `df`, `pd`, `np`, `display()`, and `chart()` available, plus `plt` and `sns` for plotting cells. It displays a final bare expression and any open figures, up to six per cell, as a notebook does.

### `backend/profiling.py`

- **`MAX_PROFILE_ROWS`** caps the profile calculation at 100,000 rows.
- **`MAX_PROFILE_COLUMNS`** caps the profile calculation at 100 columns.
- **`PREVIEW_ROWS`** sets the preview to the first five rows.
- **`profile_dataset(dataset_name)`** checks that the MongoDB collection exists, loads its rows into a Pandas DataFrame, and builds the profile. For every included column it reports the Pandas type, non-missing count, missing count and percentage, number of distinct values, and up to five example values. It also creates the five-row preview and `DataFrame.describe(include="all")` statistics. It reports the full collection row and column counts, and whether any rows or columns were omitted from the profile.
- **`get_dataset_schema(dataset_name)`** reads up to 1,000 MongoDB rows, gathers their column names, and infers a type for each column. It returns this small schema context for chat questions without sending row values to the model.

### `backend/llm.py`

- **`load_dotenv()`** reads settings from the project-root `.env` file when the module loads.
- **`OPENAI_API_KEY`** and **`OPENAI_MODEL`** are read once when the backend imports this file. The model defaults to `gpt-4o-mini` if `OPENAI_MODEL` is not set.
- **`LLMConfigurationError`** represents missing or invalid LLM configuration.
- **`LLMProviderError`** represents a failed or empty model response.
- **`load_prompt(name)`** reads `backend/prompts/<name>.txt`, and **`load_common_prompt(section)`** reads one `[section]` of `common.txt`. Files are read on every use, so prompt edits apply to the next message without a restart.
- **`_choose_task_prompts(messages)`** makes one small LLM call before each answer, using the `[task_router]` prompt and the last 5 messages. The model replies `data_overview`, `visualization`, or `both`, and only those prompt files are added. If routing fails or gives another reply, both are added. The router cannot block anything: charts still work without `visualization.txt`, but without its guidance.
- **`RUN_PYTHON_TOOL`** is the tool definition that lets the model request code execution.
- **`generate_reply(messages, selected_dataset, dataset_schema, run_code)`** runs the tool-calling loop through LangChain's `ChatOpenAI` adapter, for up to five rounds. It returns the explanation and the executed cells, leaving out failed attempts the model went on to fix.
- **`generate_dataset_overview(profile)`** sends the calculated profile to the model and asks it to explain the supplied measurements without making unsupported claims. The response is limited to 700 output tokens.

### `app/config/settings.py` and `app/database/mongodb.py`

These files form a separate settings/database path that is not used by the current FastAPI routes. `Settings` reads app, MongoDB, JWT, and LLM settings. The `app.database.mongodb` module creates a MongoDB client from those settings and its `get_database()` function returns that database. The current backend instead uses `backend/database.py`.

## What the frontend functions do

### `frontend/app.js`

- **`renderMarkdown(text)`** safely escapes text and adds basic formatting for bold text, inline code, code blocks, quoted lines, lists, and line breaks.
- **`scrollToBottom()`** scrolls the chat area down when a new message appears.
- **`addMessage(role, content, includeInContext, cells)`** saves and displays a chat message and any executed cells. `includeInContext` controls whether the message is sent back in later chat requests.
- **`addNote(content)`** shows an app message, such as a completed upload, and saves it. The server saves questions and answers itself.
- **`queueSave(path, method, body)`** and **`saveSelectedDataset()`** send notes and the dataset selection to the server, one request at a time so the order is kept.
- **`restoreConversation()`** and **`historyItemToMessages(item)`** reload the latest 100 saved turns and notes, and the dataset selection, when the page opens.
- **`renderEditableBody(message, bubble)`** and **`renderEditor(message, closeEditor)`** add the **Edit** button to the user's messages and show the inline editor.
- **`submitEdit(message, text)`** reruns an edited question on the dataset it was asked about. If the new question succeeds, the server replaces the old question and everything after it. If it fails, the old messages are kept. Earlier versions of an edited question are not kept.
- **`showWelcomeMessage()`** shows the welcome message when there is no saved chat.
- **`renderMessage(role, content, cells)`** creates the message bubble and avatar in the page, with cell outputs above the explanation.
- **`renderCell(cell)`** shows a cell's collapsible code, outputs, errors, and notices.
- **`renderTableOutput(output)`** and **`copyTableNode(source)`** rebuild a Pandas table from allowed tags only, so dataset values cannot run as markup in the page.
- **`renderImageOutput(output)`** shows a Matplotlib or Seaborn chart as an image in the chat.
- **`renderChartOutput(output)`** draws validated chart data as SVG in the chat. It supports bar, line, and scatter charts without loading an image library or external chart service.
- **`toContextContent(message)`** adds a message's code to the chat history, so follow-up questions can build on it. It does not add the output.
- **`fetchDatasets()`** calls `GET /datasets` and returns the collection names for the dataset menu.
- **`uploadDataset(file)`** sends the selected file and collection name to `POST /upload-dataset`.
- **`checkBackendHealth()`** calls the health route so the page can show whether the backend is connected.
- **`sendChatMessage()`** sends up to the latest 20 in-context messages and the selected dataset name to `POST /api/chat`.
- **`populateDatasets(datasets)`** fills the dataset dropdown with collection names.
- **`init()`** checks the backend, loads available collections, fills the menu, and displays the welcome message.
- **Event handlers** respond to sidebar toggling, choosing a dataset (confirms it is ready), opening the upload panel, choosing or dropping a file, uploading (confirms success and selects the new collection), sending chat messages, and keyboard scrolling.

The chat is stored in MongoDB, in a separate `<MONGO_DB_NAME>_app` database so it does not appear as a dataset. It survives page refreshes, server restarts, and changes of port or browser.

Each distinct dataset has a permanent 10-digit `dataset_id`, stored as text in the `datasets` collection by `backend/dataset_registry.py`. It is assigned from a hash of the rows, when a dataset is uploaded or first used in chat. The same rows get the same ID under any collection name, and replaced data with a different row count gets a new ID. An in-place edit that keeps the row count is not detected; the app itself never edits uploaded rows.

After each answer, the server saves one `conversations` document holding `question`, `answer`, `cells` (the code and outputs), `dataset`, `dataset_id`, and `created_at`, so a question and its answer stay together for later uses such as semantic search. A question that fails is not saved. App messages, such as a completed upload, are saved as separate `note` documents, and the welcome message is not saved.

There is one shared chat because the app has no login, so everyone using the same server sees and can clear it. **Clear chat history** in the sidebar permanently deletes it.

### `frontend/index.html` and `frontend/styles.css`

`index.html` defines the header, dataset selector, upload controls, chat area, message input, and script/style links. `styles.css` controls how those elements look and adapt to different screen sizes. The frontend has no direct MongoDB or OpenAI connection; it calls the FastAPI backend.

## Data sent to OpenAI

If `POST /api/datasets/{dataset_name}/profile` is called, the backend sends the dataset name, column/profile statistics, and up to five preview rows to OpenAI so the model can explain the results. The frontend does not call this endpoint when a dataset is selected. The full dataset is not sent to OpenAI by the current profiling workflow.

For chat, the frontend sends up to 20 recent messages, each limited to 4,000 characters. If a dataset is selected, the backend also sends its name, row count, column names, and inferred types to OpenAI.

**The output of every cell, up to 8,000 characters per cell, is also sent to OpenAI so the model can explain it. That output can contain raw rows from the dataset**, for example from `df.head(10)`. The full dataset is not sent unless it fits in a cell's output. Keep this in mind before using sensitive data.

## Inspect LLM requests and token usage

The backend logs the model name and API-reported input/output token counts for every model call. Agent requests can make more than one model call, so logs include per-call usage and a total for each chat turn.

To also see the exact messages sent to the model and the model's replies/tool calls, add this setting to `.env`:

```env
DEBUG_LLM_IO=true
```

Restart or recreate the backend after changing `.env`. The request log includes system instructions, recent chat history, dataset schema, and analysis output sent back to the model. This can include user text or dataset values, so turn it off when debugging is complete:

```env
DEBUG_LLM_IO=false
```

The API key is never included in these logs. Token counts come from the model response; the log does not estimate cost or include account-level billing adjustments.

## Current limitations and next steps

- No login or per-user dataset permissions.
- Generated code runs behind guard rails rather than in a real sandbox; see [How generated code is contained](#how-generated-code-is-contained).
- Each request starts from the original dataset. Changes do not carry over as they would in a notebook kernel.
- Selected code features are refused, including `df.query()`; the model filters with boolean masks instead.
- Charts are static images, with no hover or zoom. The model cannot see them, so it explains the plotted values read back from each chart. Those values are sent to OpenAI, but chart images are not.
- Downloadable reports and multiple-dataset joins are not available.
- Uploads are stored as one MongoDB document per input row; large files may need a different storage/processing strategy.
- There is no upload file-size limit yet. Legacy `.xls` files may require the `xlrd` package; `requirements.txt` currently includes `openpyxl` for modern `.xlsx` files.
- The profile limits calculations to 100,000 rows and 100 columns.
- CORS is open to all origins for development.

A natural next step is keeping `df` changes between requests, as a notebook kernel does.
