# Backend

The backend is one FastAPI app (`backend/main.py`). It signs users in, stores datasets and chat history in MongoDB, asks OpenAI to write Pandas code, runs that code in a separate sandboxed Python process, and serves the [frontend](../frontend/README.md).

See [docs/architecture.md](../docs/architecture.md) for diagrams of how the pieces connect.

## Folder layout

The code is split by feature. Each feature has thin **routes** (HTTP in and out) and a **controller** that does the work. Shared settings, the database connection and login sessions live in `core/`.

```text
backend/
  main.py                 Creates the app: CORS, no-cache header, health check,
                          the feature routers, /static, and the page routes
  core/
    config.py             Every setting read from .env, in one place
    database.py           The shared MongoDB client: `db` for datasets, `app_db` for app data
    security.py           Password hashing, login sessions, and the current_user dependency
  features/               HTTP routes and request/response models
    auth/                 routes.py, schemas.py   → /api/auth/*
    data_handling/        routes.py               → /datasets, /upload-dataset, DELETE /api/datasets/{name}
    data_analysis/        routes.py, schemas.py   → /api/chat*, /api/datasets/{name}/profile
  controllers/            The logic behind each feature
    auth.py               Creating users, checking logins, profile photos
    data_handling.py      Listing, reading, inserting and dropping datasets; dataset IDs
    data_analysis.py      Dataset schema and profile; saving and loading chat history
  tool_calling/           The LLM and the code it runs
    llm.py                Prompt router and the tool-calling loop (OpenAI through LangChain)
    tools.py              The run_python tool: loads a dataset and starts the sandbox worker
    sandbox_worker.py     Checks and runs one cell, and formats its output like Jupyter
  prompts/                Prompt text, read on every use (edits apply without a restart)
    common.txt            Short prompts as [sections]: system, no_dataset, selected_dataset,
                          dataset_schema, profile_overview, task_router
    analysis.txt          Rules for every request when a dataset is selected
    data_overview.txt     Added for tables, numbers and calculations
    visualization.txt     Added for charts
```

## Setup and run

### 1. Start MongoDB

The app connects to `mongodb://localhost:27017/` and the database `AI_Report_Database` by default.

### 2. Create `.env` in the project root

```env
OPENAI_API_KEY=your_actual_openai_api_key
OPENAI_MODEL=gpt-4o-mini
MONGO_URI=mongodb://localhost:27017/
MONGO_DB_NAME=AI_Report_Database
```

| Setting | Default | What it does |
| --- | --- | --- |
| `OPENAI_API_KEY` | none | Required for chat and profiling. Without it, those routes return HTTP 503. |
| `OPENAI_MODEL` | `gpt-4o-mini` | The model used for every LLM call. |
| `MONGO_URI` | `mongodb://localhost:27017/` | MongoDB connection address. |
| `MONGO_DB_NAME` | `AI_Report_Database` | Database for datasets. App data goes in `<MONGO_DB_NAME>_app`. |
| `SESSION_HOURS` | `12` | How long a login lasts without "Remember me". |
| `SESSION_REMEMBER_DAYS` | `30` | How long a login lasts with "Remember me". |
| `SECURE_COOKIES` | `false` | Set to `true` when served over HTTPS, so the login cookie is never sent over HTTP. |
| `DEBUG_LLM_IO` | `false` | Logs the full messages sent to and received from the model. |

Keep `.env` private; it is in `.gitignore`. Settings are read once at start-up, so restart the backend after changing them.

### 3. Install and start

From the project root in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>. You are sent to `/login` until you sign in; create an account at `/signup`. The interactive API docs are at <http://localhost:8000/docs>.

### Docker Compose

```powershell
docker compose up --build
```

`docker-compose.yml` passes the project-root `.env` to the container and mounts `./uploads` (profile photos) and `./frontend`. If MongoDB runs on the Windows host, set `MONGO_URI=mongodb://host.docker.internal:27017/`.

## API routes

All routes except health, the auth routes and the sign-in/sign-up pages need a signed-in session. Without one, API routes return **401** and page routes redirect to `/login`.

| Route | Feature | What it does |
| --- | --- | --- |
| `GET /api/health` | main | Confirms the backend is running. |
| `POST /api/auth/register` | auth | Creates an account from the two sign-up steps (multipart form, optional JPG/PNG photo up to 2 MB) and signs the user in. |
| `POST /api/auth/check-availability` | auth | Says whether an email or phone is already registered, for sign-up step 1. |
| `POST /api/auth/login` | auth | Signs in with email or phone and password. `remember` picks the session length. |
| `POST /api/auth/logout` | auth | Ends the session and removes the cookie. |
| `GET /api/auth/me` | auth | The signed-in user's public details. |
| `GET /api/auth/me/avatar` | auth | The signed-in user's profile photo, or 404. |
| `GET /datasets` | data handling | Lists dataset collection names and the database name. |
| `POST /upload-dataset` | data handling | Stores a `.csv`, `.xlsx` or `.xls` file as a new collection. Returns its rows, columns and dataset ID. |
| `DELETE /api/datasets/{name}` | data handling | Drops the collection and unselects it. Saved chats about it are kept. |
| `POST /api/chat` | data analysis | Answers a question, running Pandas code on the selected dataset as needed. Returns `reply`, `cells` and `turn_id`, and saves the turn. |
| `GET /api/chat/history` | data analysis | Summaries of recent chats (title, dataset, item count, last update), from the latest 100 saved items. |
| `GET /api/chat/history/{chat_id}` | data analysis | Every turn and note in one chat. |
| `POST /api/chat/notes` | data analysis | Saves an app message, such as a completed upload. |
| `PUT /api/chat/selected-dataset` | data analysis | Saves the selected dataset. |
| `DELETE /api/chat/history` | data analysis | Permanently deletes all saved turns and notes. |
| `POST /api/datasets/{name}/profile` | data analysis | Pandas profile of a dataset plus an LLM explanation. The frontend does not call it. |
| `GET /login`, `GET /signup` | main | The sign-in and sign-up pages. `/login` redirects to `/` when already signed in. |
| `GET /static/*` | main | Frontend files (CSS, JS). |
| `GET /` and any other path | main | The main app page, after sign-in. |

Every response carries `Cache-Control: no-cache`, so browsers pick up new frontend files. CORS allows any origin, which is convenient locally but should be restricted for a deployment.

## How a chat question is answered

1. `features/data_analysis/routes.py` `chat()` reads the selected dataset's schema with `get_dataset_schema()`: column names and inferred types from up to 1,000 rows, with no row values.
2. `tool_calling/llm.py` `generate_reply()` first makes a small **router** call (`[task_router]` prompt, last 5 messages) that picks `data_overview`, `visualization` or both. Only those prompt files are added. If routing fails, both are added.
3. The model gets the system prompts, the schema, up to 20 recent messages and the `run_python` tool. It can call the tool up to **5 rounds**, fixing errors from earlier rounds.
4. Each call goes to `tool_calling/tools.py` `run_code()`, which loads up to **100,000 rows**, writes them and the code to a temporary folder, and starts `sandbox_worker.py` with a **30-second** limit.
5. The worker returns tables (HTML), charts (PNG plus a text list of plotted values), text and errors. Up to 8,000 characters of each cell's output go back to the model.
6. The final explanation and the successful cells are returned, and `save_turn()` stores them. When a question was edited, the old turn and everything after it in that chat are removed, but only after the new turn is saved.

Numbers in the output come from running the code, not from the model.

## How generated code is contained

The code is written by an LLM and can be influenced by values inside a dataset, so `sandbox_worker.py` limits what it can do:

- It runs in a separate process with a 30-second limit and only `SYSTEMROOT`, `PATH`, `TEMP` and `TMP` in its environment, so it never sees the API key or `MONGO_URI`.
- Before running, code is checked against an allow-list of imports and a block-list of names and attributes. File readers and writers, `eval()`, `df.query()` and private attributes are refused.
- While running, a Python audit hook refuses file access, subprocesses and network connections.

**These are guard rails, not a security boundary.** In-process Python restrictions can be bypassed, and there is no memory limit. Before other people use the app, run the worker in a locked-down container with no network, a read-only filesystem, and CPU and memory limits.

## Accounts and sessions

- Passwords are hashed with **scrypt** (16-byte salt, about 16 MB of memory per hash). A password needs at least 8 characters with a number and a symbol.
- Email is stored lower-case. A phone number is stored in international form, with `+91` assumed when no country code is given. Both are unique.
- A session is a random token in an `HttpOnly`, `SameSite=Lax` cookie named `session`. Only its SHA-256 hash is stored, so a leaked database cannot be used to sign in. Logging out deletes the record, and a MongoDB TTL index removes expired ones.
- Profile photos are checked by their first bytes (PNG or JPEG only) and saved as `uploads/avatars/<user id>.<ext>`.

## Data stores

| Database | Collection | Contents |
| --- | --- | --- |
| `AI_Report_Database` (`MONGO_DB_NAME`) | one per dataset | Uploaded rows, one document per row. Every collection here is listed as a dataset. |
| `AI_Report_Database_app` | `users` | Accounts: name, email, phone, password hash, optional profile fields, photo file name. |
| | `sessions` | Hashed session tokens with their user and expiry time. |
| | `conversations` | `turn` documents (question, answer, cells, dataset, dataset ID, chat ID) and `note` documents. |
| | `chat_settings` | The selected dataset. |
| | `datasets` | Dataset IDs: content fingerprint, row count, and the collection names each ID has had. |

Each distinct dataset gets a permanent 10-digit **dataset ID** from a hash of its rows, when it is uploaded or first used in chat. The same rows get the same ID under any name. Data replaced with a different row count gets a new ID; an in-place edit that keeps the row count is not detected.

Chat history, the dataset list and the selected dataset are **shared by every signed-in user**. They are not yet separated per user.

## Data sent to OpenAI

- For chat: up to 20 recent messages (4,000 characters each), and the selected dataset's name, row count, column names and types.
- **The output of every cell, up to 8,000 characters, so the model can explain it. That output can contain raw rows**, for example from `df.head(10)`. Chart images are not sent, but their plotted values are.
- For the profile route: column statistics and up to five preview rows.

## Logging LLM requests and tokens

The backend logs the model name and the input and output token counts for every model call, plus a total per chat turn. Set `DEBUG_LLM_IO=true` to also log the exact messages and tool calls. These can include user text and dataset values, so turn it off when you are done. The API key is never logged.

## Limitations

- Chat history and datasets are shared by all users; there are no per-user permissions.
- Generated code runs behind guard rails, not in a real sandbox.
- Each request starts from the original dataset, so changes such as `df = df.dropna()` do not carry over as they would in a notebook kernel.
- Analysis and profiling use at most 100,000 rows (profiling also at most 100 columns), and the output says when rows were left out.
- No upload size limit. Uploads are stored one document per row, which may not suit very large files. Legacy `.xls` files may need the `xlrd` package.
- There is no password reset, and no way to edit a profile after sign-up.
- CORS is open to all origins.
