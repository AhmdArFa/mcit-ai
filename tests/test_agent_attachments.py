"""Agent attachments use the normal ingestion pipeline without a second upload."""

from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

from api.routers import agent
from open_notebook.exceptions import UnsupportedTypeException


@pytest.mark.asyncio
async def test_attachment_uses_source_ingestion_directly(monkeypatch):
    async def notebook(_id):
        return "notebook:example"

    async def source(form_data):
        data, file = form_data
        assert data.notebooks == ["notebook:example"]
        assert data.type == "upload"
        assert data.embed and data.async_processing
        assert await file.read() == b"document"
        return SimpleNamespace(id="source:example", status="new")

    monkeypatch.setattr(agent, "_attachment_notebook", notebook)
    monkeypatch.setattr(agent, "create_source", source)
    result = await agent.upload_attachment(
        UploadFile(filename="brief.pdf", file=BytesIO(b"document"), size=8),
        "notebook:example",
    )
    assert result["source_id"] == "source:example"
    assert result["notebook_id"] == "notebook:example"
    assert result["size"] == 8


@pytest.mark.asyncio
async def test_unsupported_file_does_not_echo_extractor_details(monkeypatch):
    async def notebook(_id):
        return "notebook:example"

    async def source(_form_data):
        raise UnsupportedTypeException("private/path/in/error")

    monkeypatch.setattr(agent, "_attachment_notebook", notebook)
    monkeypatch.setattr(agent, "create_source", source)
    with pytest.raises(HTTPException) as exc:
        await agent.upload_attachment(
            UploadFile(filename="photo.png", file=BytesIO(b"image")),
            "notebook:example",
        )
    assert exc.value.status_code == 415
    assert "private/path/in/error" not in exc.value.detail
    assert "local processors" in exc.value.detail
