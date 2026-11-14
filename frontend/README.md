# Frontend

The frontend is plain HTML, CSS and JavaScript, with no build step and no framework. The [backend](../backend/README.md) serves it: pages at `/`, `/login` and `/signup`, and the files in this folder under `/static`. It talks only to the FastAPI backend, never to MongoDB or OpenAI directly.

See [docs/architecture.md](../docs/architecture.md) for diagrams of how the pieces connect.

## Folder layout

```text
frontend/
  index.html            The main app: chats, conversation and datasets panels
  login.html            Sign-in page
  signup.html           Two-step sign-up page, then a success step
  css/
    styles.css          Design tokens (light and dark), shared controls, and the main app layout
    auth.css            Sign-in and sign-up layout, built on the tokens in styles.css
  js/
    api.js              BACKEND_URL, apiFetch() and redirectToLogin(); loaded first on every page
    data_analysis.js    App state, chat list, messages, notebook cells, charts, side panels
    data_handling.js    Dataset list, selection, upload and delete
    auth.js             Sign-in form, sign-up steps, and the account menu
```

The scripts share globals instead of modules, so they load in a fixed order:

| Page | Scripts, in order |
| --- | --- |
| `index.html` | `api.js` → `data_analysis.js` → `data_handling.js` → `auth.js` |
| `login.html`, `signup.html` | `api.js` → `auth.js` |

`data_analysis.js` defines the shared `state` object and the DOM references that `data_handling.js` uses. `auth.js` runs only the parts whose elements exist on the current page.

## The main screen

`index.html` is a three-panel workbench:

```text
┌──────────────┬───────────────────────────────────┬──────────────────┐
│ Chats        │ Title · dataset pill · Connected  │ Datasets      ⟳  │
│ + New        │                                   │ Search           │
│ Search       │  question bubble                  │ collection cards │
│ Today        │  AI Report Analyst · 2 cells ran  │  (Use / In use)  │
│ Yesterday    │  explanation                      │                  │
│ Previous 7d  │  In [1]: code   Out [1]: table    │ Add new dataset  │
│ Older        │  chart · notice                   │  name, drop zone │
│              │ ┌───────────────────────────────┐ │  progress, upload│
│ Account  ⋮   │ │ composer          dataset  ↑  │ │ Database · count │
└──────────────┴─┴───────────────────────────────┴─┴──────────────────┘
```

- **Left, chats:** New analysis (also Ctrl+K, or ⌘K on a Mac), chat search, and saved chats grouped by Today, Yesterday, Previous 7 days and Older. At the bottom is the account row. Its menu has Profile (not available yet), Switch theme, Clear all history and Log out.
- **Middle, conversation:** the top bar shows the chat title and short chat ID, the dataset pill (opens the Datasets panel), the connection status, and the button that shows or hides the Datasets panel. Below that come the messages, then the composer with the dataset chip and an attach button that opens the file picker.
- **Right, datasets:** the MongoDB collections, with search and refresh, a card per collection to select or delete it, and the upload card.

Below 1100px wide the Datasets panel floats over the chat, and below 768px so does the chat list. A dim scrim closes them when clicked.

## What each script does

### `js/api.js`

- **`BACKEND_URL`** is the page's own origin, so the frontend works on any host or port.
- **`apiFetch(url, options)`** wraps `fetch()` with the session cookie. On a 401 from a non-auth route it sends the browser to `/login` and never settles, so callers do not show an error while the page changes.
- **`redirectToLogin()`** goes to `/login`.

### `js/data_analysis.js`

- **State:** `state` holds the messages of the open chat, the dataset names, the selected dataset, the open chat's ID, the saved chat summaries and whether a request is running.
- **Recent chats:** `loadRecentChats()` fetches the summaries. `renderRecentChats()` filters them by the search box and groups them with `chatGroup()` and `relativeTime()`. `openChat()` loads one chat, `startNewChat()` starts an empty one, and `updateChatHeader()` shows the title in the top bar and the browser tab.
- **Messages:** `addMessage()`, `addError()` and `addNote()` add to the conversation. `addNote()` also saves the note, because the server saves questions and answers itself. `renderUserMessage()` and `renderEditor()` show a question with its inline **Edit**, and `submitEdit()` reruns an edited question on the dataset it was asked about. If the rerun fails, the old messages come back.
- **Answers:** `renderBotMessage()` shows the header (cells run, time taken, copy button), the explanation, then each cell. `showThinking()` shows the "Analyzing your data…" indicator while a request runs.
- **Notebook cells:** `renderCell()` shows the code (collapsed by default, with Copy and Show/Hide), then the outputs, any error, and a notice such as "only the first 100,000 rows were used".
  - `renderTableOutput()` rebuilds the Pandas table from an allow-list of tags with `copyTableNode()`, so dataset values can never run as markup. `downloadTableCsv()` saves it as a CSV file.
  - `renderImageOutput()` shows a Matplotlib or Seaborn PNG.
  - `renderChartOutput()` draws bar, line and scatter chart data as SVG, without a chart library.
  - `highlightPython()` colours the code using text nodes only.
- **Safety:** `renderMarkdown()` escapes text first, then adds bold, inline code, code blocks, quotes, lists and line breaks.
- **Saving:** `queueSave()` sends notes and the dataset selection one at a time, so the server stores them in order.
- **Requests:** `sendChatMessage()` posts up to the 20 latest messages. Only the latest answer includes its code (`toContextContent()`), so follow-ups can build on it without resending older code.
- **Panels:** `setSidebarOpen()`, `setDatasetsOpen()` and `updateScrim()` show and hide the side panels.
- **Start-up:** `init()` loads the chat list, checks `/api/health`, loads the datasets and shows the right empty-state message.

### `js/data_handling.js`

- **`fetchDatasets()`** calls `GET /datasets` and records the database name.
- **`renderDatasetList()`** draws the collection cards, filtered by the search box. **`selectDataset()`** picks one, saves the choice and adds a note.
- **`deleteDataset()`** asks for confirmation, then drops the collection through `DELETE /api/datasets/{name}`.
- **`uploadDataset()`** uploads with `XMLHttpRequest`, because `fetch()` cannot report upload progress. **`chooseFile()`** fills in a collection name from the file name, and the drop zone accepts dragged `.csv`, `.xlsx` and `.xls` files.
- **`updateDatasetUI()`** shows the selected dataset in the top bar pill, the composer chip, the panel cards and the panel footer. **`refreshDatasets()`** reloads the list.

### `js/auth.js`

- **Sign-in page:** checks the email or phone and password, posts to `/api/auth/login`, and shows server errors in a banner. "Forgot password?" explains that resets are not available yet.
- **Sign-up page:** step 1 checks name, email, optional phone, password strength and the terms box, then asks `/api/auth/check-availability` whether the email or phone is taken. Step 2 takes optional age, company, job title, industry and a JPG/PNG photo up to 2 MB, or can be skipped. Both steps post together to `/api/auth/register`.
- **Account menu (main app):** loads `/api/auth/me` to show the name, email and photo or initials, and handles opening and closing the menu and logging out.

## Styling

`css/styles.css` follows the "Computational Slate" design: Inter for text, JetBrains Mono for code, data and labels, and indigo `#4f46e5` as the primary colour.

- **Tokens** such as `--surface`, `--panel`, `--recessed`, `--primary` and `--text-muted` are defined on `:root`. Dark values apply when the theme is chosen in the account menu (`data-theme="dark"` on `<html>`) or, when nothing is chosen, from the system setting. The choice is kept in `localStorage` and applied before the page paints.
- **Icons** use the Material Symbols Outlined font: `<span class="ms">name</span>`. In JavaScript, `icon(name)` returns the same markup. The auth pages use inline SVG with an `.icon` class instead.
- `auth.css` reuses the tokens and shared classes (`.btn`, `.text-input`, `.hidden`, `.sr-only`) from `styles.css`, so changes to those affect all three pages.

## Editing tips

- Element IDs in `index.html` are looked up once at the top of `data_analysis.js`. Rename both together.
- Saved chats hold no HTML. Every message is rebuilt from data, so a change to how cells render also applies to old chats.
- The backend sends `Cache-Control: no-cache`, so a normal refresh shows your changes.
