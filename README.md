# AI Report Analyst

AI Report Analyst is a data analysis bot for data analysts and data scientists. You ask for what you want in plain language instead of writing code. The bot writes and runs the Pandas code on the selected dataset, shows the output as a Jupyter notebook would, and explains it.

## Documentation

| Document | What it covers |
| --- | --- |
| [backend/README.md](backend/README.md) | Setup and `.env` settings, folder layout, API routes, how answers are produced, the code sandbox, accounts, data stores, and data sent to OpenAI |
| [frontend/README.md](frontend/README.md) | Pages, folder layout, the three-panel main screen, what each script does, and styling |
| [docs/architecture.md](docs/architecture.md) | Diagrams of the components, a chat request, sign-in, and the dataset lifecycle |

## What it can do

- Sign up and sign in with email or phone and a password.
- Upload `.csv`, `.xlsx` or `.xls` files into MongoDB, or use collections that are already there.
- Ask for an analysis in chat: `info()`, `describe()`, null counts, filtering, grouping, correlations, charts and similar work.
- See real output for each request: DataFrames as tables (downloadable as CSV), Matplotlib and Seaborn charts as images, and printed values. The code that ran is shown under **Show code**.
- Keep several saved chats, search them, reopen them, and edit an earlier question to rerun it.

Numbers in the output come from running the code, not from the model. The model writes the explanation from that output.

## Project layout

```text
backend/            FastAPI app: routes, controllers, LLM tool calling, sandbox, prompts
frontend/           HTML, CSS and JavaScript served by the backend
docs/               Architecture diagrams
uploads/            Profile photos (created at runtime, not committed)
Dockerfile          Builds the app container
docker-compose.yml  Runs the app container with the project-root .env
requirements.txt    Python packages
pyproject.toml      Python project metadata
```

## Quick start (Windows)

1. Start MongoDB on `mongodb://localhost:27017/`.
2. Create `.env` in the project root:

   ```env
   OPENAI_API_KEY=your_actual_openai_api_key
   OPENAI_MODEL=gpt-4o-mini
   MONGO_URI=mongodb://localhost:27017/
   MONGO_DB_NAME=AI_Report_Database
   ```

3. Install and run:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
   ```

4. Open <http://localhost:8000> and create an account at `/signup`.

To run it with Docker instead, use `docker compose up --build`. The [backend README](backend/README.md#setup-and-run) lists every setting.

## Before sharing it with others

Generated code runs behind guard rails, not a real sandbox, and chat history and datasets are shared by every signed-in user. Read [How generated code is contained](backend/README.md#how-generated-code-is-contained) and [Limitations](backend/README.md#limitations) first.
