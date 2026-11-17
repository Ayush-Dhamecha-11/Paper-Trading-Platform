"""
backend/ML/hf_checkpoint_manager.py

Hugging Face Model Hub Checkpoint Manager for Paper-Trading ML models.
Implements Approach 1: Direct, continuous checkpoint uploads and retrievals
to/from Hugging Face Model Hub without accumulating local disk files.
"""

import io
import os
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import torch
import torch.nn as nn
from dotenv import load_dotenv
from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import HfHubHTTPError, RepositoryNotFoundError

logger = logging.getLogger(__name__)

# Automatically locate and load backend/.env
_CURRENT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _CURRENT_DIR.parent
_ENV_PATH = _BACKEND_DIR / ".env"
if _ENV_PATH.exists():
    load_dotenv(dotenv_path=_ENV_PATH)
else:
    load_dotenv()


def get_hf_credentials(
    token: Optional[str] = None,
    repo_id: Optional[str] = None,
) -> tuple[str, str]:
    """
    Resolve Hugging Face API token and target repository ID.
    Falls back to environment variables HF_TOKEN and HF_REPO_ID.
    """
    resolved_token = token or os.getenv("HF_TOKEN")
    resolved_repo = repo_id or os.getenv("HF_REPO_ID")

    if not resolved_token or resolved_token.strip() == "" or resolved_token == "hf_your_token_here":
        raise ValueError(
            "Hugging Face token is missing or not configured. "
            "Please set 'HF_TOKEN' in backend/.env or pass token explicitly."
        )

    if not resolved_repo or resolved_repo.strip() == "" or resolved_repo == "your_username/paper-trading-factor-model":
        raise ValueError(
            "Hugging Face repository ID is missing. "
            "Please set 'HF_REPO_ID' (e.g., 'username/repo-name') in backend/.env or pass repo_id explicitly."
        )

    return resolved_token.strip(), resolved_repo.strip()


def upload_checkpoint(
    model_or_state_dict: Union[nn.Module, Dict[str, Any]],
    filename: str,
    repo_id: Optional[str] = None,
    token: Optional[str] = None,
    commit_message: Optional[str] = None,
    private: bool = True,
) -> str:
    """
    Upload a model checkpoint directly to Hugging Face Model Hub from memory.
    Does NOT save permanent files to local disk, preventing file clutter.

    Parameters:
        model_or_state_dict: PyTorch nn.Module or state_dict dictionary.
        filename: Destination path in the repository (e.g., 'K30_checkpoint_window_01.pt').
        repo_id: Hugging Face repo ID ('username/model-name'). If None, reads from env.
        token: Hugging Face write token. If None, reads from env.
        commit_message: Optional git commit description.
        private: Whether to create the repo as private if it doesn't already exist.

    Returns:
        Hugging Face Hub URL or file path of the uploaded checkpoint.
    """
    hf_token, target_repo = get_hf_credentials(token, repo_id)
    api = HfApi(token=hf_token)

    # Ensure target repository exists on Hugging Face
    try:
        api.create_repo(
            repo_id=target_repo,
            repo_type="model",
            private=private,
            exist_ok=True,
        )
    except Exception as exc:
        logger.warning(f"Note on create_repo for {target_repo}: {exc}")

    # Extract state_dict
    if isinstance(model_or_state_dict, nn.Module):
        state_dict = model_or_state_dict.state_dict()
    elif isinstance(model_or_state_dict, dict):
        state_dict = model_or_state_dict
    else:
        raise TypeError("model_or_state_dict must be a PyTorch nn.Module or state_dict dict.")

    # Serialize directly into an in-memory buffer (no local file growth)
    buffer = io.BytesIO()
    torch.save(state_dict, buffer)
    buffer.seek(0)

    msg = commit_message or f"Upload model checkpoint: {filename}"
    logger.info(f"Uploading checkpoint '{filename}' directly to Hugging Face repo '{target_repo}'...")

    try:
        commit_info = api.upload_file(
            path_or_fileobj=buffer,
            path_in_repo=filename,
            repo_id=target_repo,
            repo_type="model",
            commit_message=msg,
        )
        logger.info(f"Successfully uploaded '{filename}' to Hugging Face [{target_repo}].")
        return str(commit_info)
    except Exception as exc:
        logger.error(f"Failed to upload checkpoint '{filename}' to Hugging Face: {exc}")
        raise


def download_checkpoint(
    filename: str,
    repo_id: Optional[str] = None,
    token: Optional[str] = None,
    device: str = "cpu",
) -> Dict[str, Any]:
    """
    Download a model checkpoint from Hugging Face Model Hub and load its state_dict.

    Parameters:
        filename: Path of the checkpoint file in the HF repository.
        repo_id: Hugging Face repo ID. If None, reads from env.
        token: Hugging Face read token. If None, reads from env.
        device: Device to map tensors to ('cpu' or 'cuda').

    Returns:
        PyTorch state_dict dictionary.
    """
    hf_token, target_repo = get_hf_credentials(token, repo_id)
    logger.info(f"Downloading checkpoint '{filename}' from Hugging Face repo '{target_repo}'...")

    try:
        cached_file_path = hf_hub_download(
            repo_id=target_repo,
            filename=filename,
            token=hf_token,
            repo_type="model",
        )
        state_dict = torch.load(cached_file_path, map_location=device)
        logger.info(f"Successfully loaded checkpoint '{filename}' from {cached_file_path}.")
        return state_dict
    except (HfHubHTTPError, RepositoryNotFoundError) as exc:
        logger.error(f"Hugging Face hub error downloading '{filename}': {exc}")
        raise
    except Exception as exc:
        logger.error(f"Unexpected error loading checkpoint '{filename}': {exc}")
        raise


def load_checkpoint_into_model(
    model: nn.Module,
    filename: str,
    repo_id: Optional[str] = None,
    token: Optional[str] = None,
    device: str = "cpu",
    strict: bool = True,
) -> nn.Module:
    """
    Convenience function: downloads a checkpoint from Hugging Face and
    loads the weights directly into the provided PyTorch model instance.
    """
    state_dict = download_checkpoint(
        filename=filename,
        repo_id=repo_id,
        token=token,
        device=device,
    )
    model.load_state_dict(state_dict, strict=strict)
    model.to(device)
    return model


def list_remote_checkpoints(
    repo_id: Optional[str] = None,
    token: Optional[str] = None,
) -> List[str]:
    """
    List all checkpoint files (.pt, .safetensors, .bin) available in the Hugging Face repository.
    """
    hf_token, target_repo = get_hf_credentials(token, repo_id)
    api = HfApi(token=hf_token)
    try:
        files = api.list_repo_files(repo_id=target_repo, repo_type="model")
        checkpoints = [
            f for f in files if f.endswith(".pt") or f.endswith(".safetensors") or f.endswith(".bin")
        ]
        return checkpoints
    except Exception as exc:
        logger.error(f"Failed to list files in repo '{target_repo}': {exc}")
        raise
