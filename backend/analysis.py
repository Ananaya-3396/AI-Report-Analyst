"""Run LLM-written Pandas code against a selected dataset in a separate process."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd

from backend.database import get_database


MAX_ANALYSIS_ROWS = 100_000
CODE_TIMEOUT_SECONDS = 30
WORKER_PATH = Path(__file__).with_name("sandbox_worker.py")
# The worker gets only what Python needs on Windows, so API keys are not inherited.
WORKER_ENV_VARS = ("SYSTEMROOT", "PATH", "TEMP", "TMP")


def load_dataframe(dataset_name: str) -> tuple[pd.DataFrame, int]:
    """Load a collection and return it with the collection's full row count."""
    db = get_database()
    if dataset_name not in db.list_collection_names():
        raise KeyError(dataset_name)

    collection = db[dataset_name]
    total_rows = collection.count_documents({})
    documents = list(
        collection.find({}, {"_id": 0}).limit(MAX_ANALYSIS_ROWS)
    )
    if not documents:
        raise ValueError("The selected dataset has no rows.")
    return pd.DataFrame.from_records(documents), total_rows


def run_code(dataset_name: str, code: str) -> dict:
    """Execute one cell and return its code, notebook-style outputs, and any error."""
    df, total_rows = load_dataframe(dataset_name)
    notice = None
    if total_rows > len(df):
        notice = f"Calculated on the first {len(df):,} of {total_rows:,} rows."

    with tempfile.TemporaryDirectory() as workdir:
        workdir_path = Path(workdir)
        df.to_pickle(workdir_path / "data.pkl")
        (workdir_path / "code.py").write_text(code, encoding="utf-8")
        env = {name: os.environ[name] for name in WORKER_ENV_VARS if name in os.environ}

        try:
            subprocess.run(
                [sys.executable, "-I", str(WORKER_PATH), workdir, str(CODE_TIMEOUT_SECONDS)],
                cwd=workdir,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=CODE_TIMEOUT_SECONDS + 15,
            )
        except subprocess.TimeoutExpired:
            pass

        result_path = workdir_path / "result.json"
        if result_path.exists():
            result = json.loads(result_path.read_text(encoding="utf-8"))
        else:
            result = {
                "outputs": [],
                "error": f"The code did not finish within {CODE_TIMEOUT_SECONDS} seconds, or it crashed.",
            }

    return {"code": code, "notice": notice, **result}
