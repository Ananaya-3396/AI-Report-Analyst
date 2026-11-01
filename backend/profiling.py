"""Pandas-based dataset profiling for the first analysis workflow."""

from __future__ import annotations

import json

import pandas as pd

from backend.database import get_database


MAX_PROFILE_ROWS = 100_000
MAX_PROFILE_COLUMNS = 100
PREVIEW_ROWS = 5


def get_dataset_schema(dataset_name: str) -> dict:
    """Return column names and inferred types from a small MongoDB sample."""
    db = get_database()
    if dataset_name not in db.list_collection_names():
        raise KeyError(dataset_name)

    collection = db[dataset_name]
    total_rows = collection.count_documents({})
    documents = list(
        collection.find({}, {"_id": 0}).limit(1_000)
    )
    if not documents:
        raise ValueError("The selected dataset has no rows.")

    df = pd.DataFrame.from_records(documents)
    return {
        "dataset_name": dataset_name,
        "row_count": total_rows,
        "inspected_rows": len(df),
        "sampled": total_rows > len(df),
        "columns": [
            {"name": str(name), "type": str(dtype)}
            for name, dtype in df.dtypes.items()
        ],
    }


def profile_dataset(dataset_name: str) -> dict:
    db = get_database()
    if dataset_name not in db.list_collection_names():
        raise KeyError(dataset_name)

    collection = db[dataset_name]
    total_rows = collection.count_documents({})
    documents = list(
        collection.find({}, {"_id": 0}).limit(MAX_PROFILE_ROWS)
    )
    if not documents:
        raise ValueError("The selected dataset has no rows to profile.")

    df = pd.DataFrame.from_records(documents)
    total_columns = len(df.columns)
    omitted_columns = max(0, total_columns - MAX_PROFILE_COLUMNS)
    df = df.iloc[:, :MAX_PROFILE_COLUMNS]

    columns = []
    for name in df.columns:
        series = df[name]
        sample_values = series.dropna().astype(str).drop_duplicates().head(5).tolist()
        columns.append({
            "name": str(name),
            "dtype": str(series.dtype),
            "non_null_count": int(series.notna().sum()),
            "missing_count": int(series.isna().sum()),
            "missing_percent": round(float(series.isna().mean() * 100), 2),
            "distinct_count": int(series.nunique(dropna=True)),
            "sample_values": sample_values,
        })

    describe = df.describe(include="all").transpose()
    describe_json = json.loads(describe.to_json(orient="index", date_format="iso"))
    preview = json.loads(
        df.head(PREVIEW_ROWS).to_json(orient="records", date_format="iso")
    )

    return {
        "dataset_name": dataset_name,
        "row_count": total_rows,
        "profiled_row_count": len(df),
        "sampled_rows": total_rows > len(df),
        "column_count": total_columns,
        "profiled_column_count": len(df.columns),
        "omitted_column_count": omitted_columns,
        "columns": columns,
        "preview": preview,
        "describe": describe_json,
    }
