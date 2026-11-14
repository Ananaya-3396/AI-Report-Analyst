import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from backend.controllers.data_analysis import clear_selected_dataset_if
from backend.controllers.data_handling import (
    SUPPORTED_EXTENSIONS,
    delete_dataset,
    forget_dataset_name,
    get_dataset_id,
    get_dataset_names,
    insert_dataset,
    read_uploaded_file,
)
from backend.core.config import DB_NAME
from backend.core.security import current_user


router = APIRouter(tags=["data handling"], dependencies=[Depends(current_user)])


# --------------------------------------------------
# Get MongoDB Datasets
# --------------------------------------------------

@router.get("/datasets")
def get_datasets():

    datasets = get_dataset_names()

    return {
        "database": DB_NAME,
        "datasets": datasets
    }


@router.delete("/api/datasets/{dataset_name}")
def remove_dataset(dataset_name: str):
    """Drop a dataset's collection from MongoDB and unselect it. Saved chats about it are kept."""
    if dataset_name not in get_dataset_names():
        raise HTTPException(status_code=404, detail="Dataset collection was not found.")

    delete_dataset(dataset_name)
    forget_dataset_name(dataset_name)
    clear_selected_dataset_if(dataset_name)
    return {"deleted": dataset_name}


# --------------------------------------------------
# Upload CSV / Excel
# --------------------------------------------------

@router.post("/upload-dataset")
async def upload_dataset(
    file: UploadFile = File(...),
    collection_name: str = Form(...)
):

    collection_name = collection_name.strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", collection_name):
        raise HTTPException(
            status_code=400,
            detail="Collection name must be 1–120 characters and use only letters, numbers, underscores, or hyphens."
        )

    if collection_name in get_dataset_names():
        raise HTTPException(
            status_code=409,
            detail=f"A collection named '{collection_name}' already exists in {DB_NAME}. Choose another name."
        )

    if not file.filename.lower().endswith(SUPPORTED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Only CSV and Excel files are supported."
        )

    try:
        df = read_uploaded_file(file.filename, await file.read())

        if df.empty:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty."
            )

        inserted_count = insert_dataset(
            collection_name,
            df.to_dict(orient="records")
        )

        return {
            "message": "Dataset uploaded successfully.",
            "database": DB_NAME,
            "dataset_name": collection_name,
            "dataset_id": get_dataset_id(collection_name),
            "rows": inserted_count,
            "columns": list(df.columns)
        }

    except HTTPException:
        raise
    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
