# Architecture

AI Report Analyst is one FastAPI process. It serves the browser app, stores datasets and chat history in MongoDB, asks OpenAI to write Pandas code, and runs that code in a separate sandboxed Python process.

The diagrams use Mermaid, which GitHub, GitLab, and VS Code (with a Mermaid extension) render.

## Components

```mermaid
flowchart LR
    user([Analyst in a browser])

    subgraph browser["Browser — frontend/"]
        ui["index.html + styles.css<br/>Sidebar · chat · notebook cells"]
        js["app.js<br/>State, API calls, rendering"]
        ui --- js
    end

    subgraph api["FastAPI app — backend/main.py"]
        routes["Routes<br/>/api/chat · /api/chat/history · /api/chat/notes<br/>/api/chat/selected-dataset · /datasets<br/>/upload-dataset · DELETE /api/datasets/{name}<br/>/api/datasets/{name}/profile · /static"]
        llm["llm.py<br/>Prompt router + tool-calling loop<br/>(up to 5 run_python rounds)"]
        prompts[("prompts/<br/>common · analysis<br/>data_overview · visualization")]
        profiling["profiling.py<br/>Schema for the prompt,<br/>Pandas profile"]
        analysis["analysis.py<br/>Loads ≤100,000 rows,<br/>starts the worker"]
        history["chat_history.py<br/>Turns, notes, selection"]
        registry["dataset_registry.py<br/>Content-based dataset IDs"]
        database["database.py<br/>MongoDB client, list,<br/>insert, drop"]
    end

    subgraph sandbox["Separate process — sandbox_worker.py"]
        worker["Checks code against allow/block lists<br/>Audit hook blocks files, network, subprocesses<br/>30 s limit · no secrets in env<br/>Formats output like Jupyter"]
    end

    subgraph mongo["MongoDB"]
        datasets[("AI_Report_Database<br/>one collection per dataset")]
        appdb[("AI_Report_Database_app<br/>conversations · chat_settings · datasets")]
    end

    openai["OpenAI API<br/>(OPENAI_MODEL, default gpt-4o-mini)"]

    user --> ui
    js -- "fetch / XHR (JSON, multipart)" --> routes

    routes --> llm
    routes --> history
    routes --> database
    routes --> registry
    routes --> profiling

    llm --> prompts
    llm -- "chat completions + tool calls" --> openai
    llm -- "run_python(code)" --> analysis
    profiling --> database
    analysis --> database
    analysis -- "data.pkl + code.py<br/>in a temp folder" --> worker
    worker -- "result.json" --> analysis

    database --> datasets
    history --> appdb
    registry --> appdb
```

## How a chat question is answered

```mermaid
sequenceDiagram
    autonumber
    actor U as Analyst
    participant FE as app.js
    participant API as main.py /api/chat
    participant P as profiling.py
    participant L as llm.py
    participant O as OpenAI
    participant A as analysis.py
    participant W as sandbox_worker.py
    participant M as MongoDB

    U->>FE: Types a question
    FE->>API: POST messages (last 20), selected_dataset, replaces_id
    API->>P: get_dataset_schema(dataset)
    P->>M: Read column names and types
    API->>L: generate_reply(messages, schema, run_code)
    L->>O: Router call: which task prompts are needed?
    O-->>L: Picks data_overview and/or visualization

    loop Up to 5 tool rounds
        L->>O: System prompts + schema + chat, run_python tool
        O-->>L: Tool call with Pandas code
        L->>A: run_code(dataset, code)
        A->>M: Load up to 100,000 rows
        A->>W: Start isolated Python process
        W-->>A: Outputs (tables, charts, text) or error
        A-->>L: Cell result
        L->>O: Tool result (output or traceback to fix)
    end

    O-->>L: Final explanation
    L-->>API: reply + cells
    API->>M: save_turn (replaces edited turn and later ones)
    API-->>FE: reply, cells, turn_id
    FE-->>U: Notebook cells, then the explanation
```

## Dataset lifecycle

```mermaid
flowchart LR
    file["CSV / XLSX / XLS file"] -- "POST /upload-dataset" --> parse["Pandas reads the file<br/>NaN → null"]
    parse --> insert["insert_many into<br/>a new collection"]
    insert --> id["dataset_registry assigns<br/>a 10-digit ID from the rows"]
    id --> select["Selected in the app<br/>and saved in chat_settings"]
    select --> analyse["Used by chat and profiling"]
    analyse -- "DELETE /api/datasets/{name}" --> drop["Collection dropped<br/>Name unlinked from its ID<br/>Unselected if selected"]
```

## Data stores

| Database | Collection | Contents |
| --- | --- | --- |
| `AI_Report_Database` (`MONGO_DB_NAME`) | one per dataset | Uploaded or existing rows. Every collection here is listed as a dataset. |
| `AI_Report_Database_app` | `conversations` | `turn` documents (question, answer, cells, dataset, dataset ID) and `note` documents. |
| | `chat_settings` | The selected dataset. |
| | `datasets` | Registry of content fingerprints, row counts, and the names each ID has had. |

## Not in the main path

- `app/config/settings.py` and `app/database/mongodb.py` define another settings and database path. `backend/main.py` does not use them.
- `POST /api/datasets/{name}/profile` exists, but the frontend does not call it.
- Deployment is one container (`Dockerfile`, `docker-compose.yml`) running `uvicorn backend.main:app` on port 8000. MongoDB and OpenAI are external.
