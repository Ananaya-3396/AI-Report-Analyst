# Architecture

AI Report Analyst is one FastAPI process. It serves the browser app, signs users in, stores datasets and chat history in MongoDB, asks OpenAI to write Pandas code, and runs that code in a separate sandboxed Python process.

For details, see the [backend README](../backend/README.md) and the [frontend README](../frontend/README.md). The diagrams use Mermaid, which GitHub, GitLab and VS Code (with a Mermaid extension) render.

## Components

```mermaid
flowchart LR
    user([Analyst in a browser])

    subgraph browser["Frontend — frontend/"]
        pages["index.html · login.html · signup.html<br/>css/styles.css · css/auth.css"]
        apijs["js/api.js<br/>apiFetch, redirect on 401"]
        analysisjs["js/data_analysis.js<br/>State, chats, messages, cells, panels"]
        handlingjs["js/data_handling.js<br/>Dataset list, upload, delete"]
        authjs["js/auth.js<br/>Sign-in, sign-up, account menu"]
        pages --- analysisjs
        pages --- handlingjs
        pages --- authjs
        analysisjs --> apijs
        handlingjs --> apijs
        authjs --> apijs
    end

    subgraph backend["Backend — FastAPI (backend/main.py)"]
        subgraph features["features/ — routes"]
            authr["auth<br/>/api/auth/*"]
            handlingr["data_handling<br/>/datasets · /upload-dataset<br/>DELETE /api/datasets/{name}"]
            analysisr["data_analysis<br/>/api/chat* · /profile"]
        end
        subgraph controllers["controllers/"]
            authc["auth.py<br/>Users, logins, photos"]
            handlingc["data_handling.py<br/>Datasets, dataset IDs"]
            analysisc["data_analysis.py<br/>Schema, profile, chat history"]
        end
        subgraph tools["tool_calling/"]
            llm["llm.py<br/>Prompt router +<br/>tool loop (≤5 rounds)"]
            runner["tools.py<br/>run_python: load ≤100,000 rows,<br/>start the worker"]
        end
        subgraph core["core/"]
            config["config.py<br/>.env settings"]
            security["security.py<br/>scrypt, sessions,<br/>current_user"]
            database["database.py<br/>db · app_db"]
        end
        prompts[("prompts/")]
        pagesr["Page routes<br/>/ · /login · /signup · /static"]
    end

    subgraph sandbox["Separate process — tool_calling/sandbox_worker.py"]
        worker["Allow/block lists · audit hook<br/>30 s limit · no secrets in env<br/>Jupyter-style output"]
    end

    subgraph mongo["MongoDB"]
        datasets[("AI_Report_Database<br/>one collection per dataset")]
        appdb[("AI_Report_Database_app<br/>users · sessions · conversations<br/>chat_settings · datasets")]
    end

    files[("uploads/avatars/")]
    openai["OpenAI API<br/>(OPENAI_MODEL)"]

    user --> pages
    apijs -- "fetch / XHR with session cookie" --> features
    user -- "page loads" --> pagesr

    authr --> authc
    handlingr --> handlingc
    analysisr --> analysisc
    analysisr --> llm
    features -. "current_user" .-> security
    pagesr -. "signed in?" .-> security

    llm --> prompts
    llm -- "chat completions + tool calls" --> openai
    llm -- "run_python(code)" --> runner
    runner -- "data.pkl + code.py in a temp folder" --> worker
    worker -- "result.json" --> runner

    authc --> security
    authc --> files
    security --> database
    handlingc --> database
    analysisc --> database
    runner --> database
    database --> datasets
    database --> appdb
```

Each feature keeps HTTP handling in `features/<name>/routes.py` and the work in `controllers/<name>.py`. Everything shares one MongoDB client and one set of settings from `core/`.

## Pages and sign-in

```mermaid
sequenceDiagram
    autonumber
    actor U as Analyst
    participant B as Browser
    participant M as main.py page routes
    participant A as /api/auth
    participant S as core/security.py
    participant DB as MongoDB app_db

    U->>B: Opens /
    B->>M: GET /
    M->>S: get_session_user(cookie)
    S-->>M: None
    M-->>B: Redirect to /login
    U->>B: Enters email or phone and password
    B->>A: POST /api/auth/login
    A->>DB: Find user, check scrypt hash
    A->>S: create_session(remember)
    S->>DB: Store SHA-256 of the token with an expiry
    A-->>B: Set-Cookie session (HttpOnly, SameSite=Lax)
    B->>M: GET /
    M-->>B: index.html
    B->>A: GET /api/auth/me
    A-->>B: Name, email, photo flag
    Note over B,A: Any later 401 sends the browser back to /login (api.js)
```

## How a chat question is answered

```mermaid
sequenceDiagram
    autonumber
    actor U as Analyst
    participant FE as data_analysis.js
    participant R as features/data_analysis/routes.py
    participant C as controllers/data_analysis.py
    participant L as tool_calling/llm.py
    participant O as OpenAI
    participant T as tool_calling/tools.py
    participant W as sandbox_worker.py
    participant M as MongoDB

    U->>FE: Types a question
    FE->>R: POST /api/chat (last 20 messages, dataset, chat_id, replaces_id)
    R->>C: get_dataset_schema(dataset)
    C->>M: Read column names and types (≤1,000 rows)
    R->>L: generate_reply(messages, schema, run_cell)
    L->>O: Router call: which task prompts are needed?
    O-->>L: data_overview and/or visualization

    loop Up to 5 tool rounds
        L->>O: System prompts + schema + chat, run_python tool
        O-->>L: Tool call with Pandas code
        L->>T: run_code(dataset, code)
        T->>M: Load up to 100,000 rows
        T->>W: Start isolated Python process
        W-->>T: Tables, charts, text, or an error
        T-->>L: Cell result
        L->>O: Tool output (≤8,000 chars) or traceback to fix
    end

    O-->>L: Final explanation
    L-->>R: reply + cells
    R->>C: save_turn (removes an edited turn and later ones)
    C->>M: conversations
    R-->>FE: reply, cells, turn_id
    FE-->>U: Explanation, then notebook cells
    FE->>R: GET /api/chat/history (refresh the chat list)
```

## Dataset lifecycle

```mermaid
flowchart LR
    file["CSV / XLSX / XLS file"] -- "POST /upload-dataset<br/>(data_handling.js, XHR with progress)" --> check["Name and extension checked<br/>Duplicate names refused"]
    check --> parse["Pandas reads the file<br/>NaN → null"]
    parse --> insert["insert_many into<br/>a new collection"]
    insert --> id["get_dataset_id assigns<br/>a 10-digit ID from the rows"]
    id --> select["Selected in the Datasets panel<br/>Saved in chat_settings"]
    select --> analyse["Used by chat and profiling"]
    analyse -- "DELETE /api/datasets/{name}" --> drop["Collection dropped<br/>Name unlinked from its ID<br/>Unselected if selected<br/>Saved chats kept"]
```

## Data stores

| Store | Collection or folder | Contents |
| --- | --- | --- |
| `AI_Report_Database` (`MONGO_DB_NAME`) | one per dataset | Uploaded or existing rows. Every collection here is listed as a dataset. |
| `AI_Report_Database_app` | `users` | Accounts and their password hashes. Email and phone are unique. |
| | `sessions` | SHA-256 hashes of session tokens. A TTL index removes expired ones. |
| | `conversations` | `turn` and `note` documents, grouped into chats by `chat_id`. |
| | `chat_settings` | The selected dataset. |
| | `datasets` | Dataset IDs, content fingerprints, row counts and names. |
| Disk | `uploads/avatars/` | Profile photos, named by user ID. |

Chat history, datasets and the selected dataset are shared by every signed-in user. Users and sessions are the only per-user data.

## Deployment

One container (`Dockerfile`, `docker-compose.yml`) runs `uvicorn backend.main:app` on port 8000, with `./uploads` and `./frontend` mounted. MongoDB and OpenAI are external services. The profile route `POST /api/datasets/{name}/profile` exists, but the frontend does not call it.
