#!/usr/bin/env python3
"""Static guardrails for V15.10.7 photo performance behavior."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = (root / "app-v13.js").read_text(encoding="utf-8")
index = (root / "index.html").read_text(encoding="utf-8")
sw = (root / "service-worker-v13.js").read_text(encoding="utf-8")

assert "function scheduleFeedImageLoading()" in app
assert "IntersectionObserver" in app
assert "data-deferred-image" in app
assert "attachment.preview_storage_path || attachment.storage_path" in app
assert "Math.min(3, source.length)" in app
assert "fullAttachmentUrl(attachment)" in app
assert "const url = fullAttachmentUrl(attachment);" in app
assert "app-v13.js?v=15.10.7" in index
assert "journal-chantier-connecte-v15.10.7" in sw
print("PASS V15.10.7: loading différé, original conservé et envoi parallèle vérifiés.")
