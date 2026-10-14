"""Integration tests for the in-app editors without a database dependency."""

import pytest

from api.routers import editors
from open_notebook.agent import engine
from open_notebook.exports import storage
from open_notebook.exports.content import StudioDocument
from open_notebook.exports.workflow import AUDITS


@pytest.fixture
def studio_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "STUDIO_DIR", tmp_path)
    monkeypatch.setattr(storage, "INDEX", tmp_path / "index.json")


@pytest.mark.asyncio
async def test_new_deck_edits_keep_same_file_and_pass_audit(studio_dir):
    item = await editors.new_file(editors.NewFile(format="pptx", title="Field test"))
    file_id = item["id"]
    opened = await editors.open_file(file_id)
    assert opened["mode"] == "deck"
    assert len(opened["document"]["slides"]) == 2

    doc = StudioDocument.model_validate(opened["document"])
    doc.slides[0].title = "Edited in place"
    result = await editors.save_document(file_id, editors.DocumentUpdate(document=doc))
    assert result["file"]["id"] == file_id
    assert result["file"]["version"] == 2
    assert result["audit_issues"] == []
    assert (await editors.open_file(file_id))["document"]["slides"][0][
        "title"
    ] == "Edited in place"
    assert AUDITS["pptx"](storage.get_file(file_id).path.read_bytes(), doc) == []


@pytest.mark.asyncio
async def test_pdf_page_edit_detaches_document_metadata(studio_dir):
    item = await editors.new_file(editors.NewFile(format="pdf", title="Page test"))
    file_id = item["id"]
    assert (await editors.open_file(file_id))["pages"] >= 1
    changed = await editors.reorder_pages(file_id, editors.PageOrder(order=[0]))
    assert changed["file"]["id"] == file_id
    assert changed["file"]["version"] == 2
    assert changed["file"]["document_id"] is None
    assert (await editors.open_file(file_id))["mode"] == "pdf"


@pytest.mark.asyncio
async def test_run_error_never_exposes_exception_details():
    async def fail(_run):
        raise RuntimeError("PRIVATE-DOCUMENT-CONTENT")

    run = engine.start("studio", fail, "studio")
    await run.task
    assert run.status == "failed"
    assert "PRIVATE-DOCUMENT-CONTENT" not in str(run.events)
