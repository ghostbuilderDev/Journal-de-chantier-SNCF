/* Presentation only: the existing collaboration panel retains its handlers. */
(function (root) {
  'use strict';
  const positionKey = 'journal-report-actions-position-v1';

  function mount(panel) {
    const status = document.createElement('p');
    status.id = 'reportSaveStatus';
    status.className = 'report-save-status no-print';
    status.setAttribute('role', 'status');
    document.querySelector('.topbar').after(status);

    const dialog = document.createElement('dialog');
    dialog.id = 'reportActionsDialog';
    dialog.className = 'report-actions-dialog no-print';
    dialog.setAttribute('aria-labelledby', 'reportActionsTitle');
    dialog.innerHTML = `<header class="report-actions-header"><h2 id="reportActionsTitle">Actions du rapport</h2><button type="button" data-actions-close autofocus>Fermer <span aria-hidden="true">×</span></button></header><div class="report-actions-body"></div>`;
    const body = dialog.querySelector('.report-actions-body');
    body.append(panel);
    document.body.append(dialog);

    const button = document.createElement('button');
    button.id = 'reportActionsButton';
    button.className = 'report-actions-button no-print';
    button.type = 'button';
    button.disabled = true;
    button.setAttribute('aria-label', 'Actions du rapport');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', dialog.id);
    button.setAttribute('aria-expanded', 'false');
    button.title = 'Actions du rapport · glisser pour déplacer';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3.5"/></svg><span>Actions</span>';
    document.querySelector('.app-shell').append(button);

    let allowed = false, anchor = {x: 1, y: .82}, drag = null, suppressClick = false, compatibilityClick = false, frame = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey));
      if (saved && [saved.x, saved.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) anchor = saved;
    } catch (_) { /* The menu also works when local storage is unavailable. */ }
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    function bounds() {
      const v = root.visualViewport, style = getComputedStyle(button);
      const safe = edge => parseFloat(style.getPropertyValue('--report-safe-' + edge)) || 0;
      const left = (v?.offsetLeft || 0) + 10 + safe('left');
      const top = (v?.offsetTop || 0) + 10 + safe('top');
      return {left, top,
        right: Math.max(left, (v?.offsetLeft || 0) + (v?.width || innerWidth) - button.offsetWidth - 10 - safe('right')),
        bottom: Math.max(top, (v?.offsetTop || 0) + (v?.height || innerHeight) - button.offsetHeight - 10 - safe('bottom'))};
    }
    function place(x, y, remember = false) {
      const b = bounds(), left = clamp(x, b.left, b.right), top = clamp(y, b.top, b.bottom);
      button.style.left = left + 'px'; button.style.top = top + 'px';
      if (remember) {
        anchor = {x: (left - b.left) / (b.right - b.left || 1), y: (top - b.top) / (b.bottom - b.top || 1)};
        try { localStorage.setItem(positionKey, JSON.stringify(anchor)); } catch (_) {}
      }
    }
    function reflow() {
      if (drag) return;
      const b = bounds();
      let x = b.left + anchor.x * (b.right - b.left), y = b.top + anchor.y * (b.bottom - b.top);
      const active = document.activeElement;
      // Temporarily clear the focused field without replacing the user's position.
      if (active?.matches('input,textarea,select,[contenteditable="true"]')) {
        const r = active.getBoundingClientRect(), w = button.offsetWidth, h = button.offsetHeight;
        if (x < r.right + 8 && x + w > r.left - 8 && y < r.bottom + 8 && y + h > r.top - 8) {
          if (r.top - h - 12 >= b.top) y = r.top - h - 12;
          else if (r.bottom + 12 <= b.bottom) y = r.bottom + 12;
          else x = x > (b.left + b.right) / 2 ? b.left : b.right;
        }
      }
      place(x, y);
    }
    function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(reflow); }
    root.addEventListener('resize', schedule);
    root.visualViewport?.addEventListener('resize', schedule);
    root.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    reflow();

    // Consume the click synthesized after pointerup, even if opening the modal
    // puts another command underneath the finger. A new press is a new action.
    document.addEventListener('pointerdown', () => { compatibilityClick = false; }, true);
    document.addEventListener('click', e => {
      if (!compatibilityClick || e.detail === 0) return;
      compatibilityClick = false; e.preventDefault(); e.stopImmediatePropagation();
    }, true);

    button.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button !== 0 || button.disabled) return;
      const r = button.getBoundingClientRect();
      drag = {id: e.pointerId, x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false};
      suppressClick = false;
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 8) drag.moved = true;
      if (!drag.moved) return;
      button.classList.add('is-dragging');
      place(drag.left + dx, drag.top + dy);
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const tapped = e.type === 'pointerup' && !drag.moved;
      compatibilityClick = e.type === 'pointerup';
      suppressClick = drag.moved || e.type === 'pointercancel';
      if (drag.moved) { const r = button.getBoundingClientRect(); place(r.left, r.top, true); }
      drag = null; button.classList.remove('is-dragging');
      // Touch browsers may omit the compatibility click after a drag/capture.
      if (tapped) { e.preventDefault(); open(); }
    }
    button.addEventListener('pointerup', end);
    button.addEventListener('pointercancel', end);
    button.addEventListener('lostpointercapture', end);
    button.addEventListener('keydown', e => {
      const moves = {ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24]};
      if (!e.shiftKey || !moves[e.key]) return;
      e.preventDefault(); const r = button.getBoundingClientRect(), [dx, dy] = moves[e.key];
      place(r.left + dx, r.top + dy, true);
    });
    function open() {
      if (!allowed || dialog.open) return;
      dialog.showModal();
      button.setAttribute('aria-expanded', 'true');
      document.documentElement.classList.add('report-actions-open');
    }
    button.addEventListener('click', e => {
      if (suppressClick && e.detail !== 0) return;
      open();
    });
    const close = () => { if (dialog.open) dialog.close(); };
    dialog.querySelector('[data-actions-close]').onclick = close;
    dialog.addEventListener('close', () => {
      button.setAttribute('aria-expanded', 'false');
      document.documentElement.classList.remove('report-actions-open');
      if (allowed) button.focus({preventScroll: true});
    });
    // Native dialogs keep keyboard focus inside and support Escape/Android Back.
    let outside = false;
    const backdrop = e => {
      const r = dialog.getBoundingClientRect();
      return e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    };
    dialog.addEventListener('pointerdown', e => { outside = backdrop(e); });
    dialog.addEventListener('click', e => { if (outside && backdrop(e)) close(); outside = false; });

    return {
      close,
      enable(value) { allowed = !!value; button.disabled = !allowed; if (!allowed) close(); },
      status(text, error = false) {
        status.textContent = text; status.classList.toggle('error', error);
        button.classList.toggle('has-error', error);
        button.setAttribute('aria-label', error ? 'Actions du rapport · enregistrement à vérifier' : 'Actions du rapport');
      },
      capture() {
        const focused = panel.contains(document.activeElement) ? [...document.activeElement.attributes].find(a => a.name.startsWith('data-share-'))?.name : null;
        return {history: !!panel.querySelector('details')?.open, scroll: body.scrollTop, focused};
      },
      restore(view) {
        const history = panel.querySelector('details'); if (history && view) history.open = view.history;
        body.scrollTop = view?.scroll || 0;
        if (dialog.open && view?.focused) panel.querySelector('[' + view.focused + ']')?.focus({preventScroll: true});
      }
    };
  }
  root.JournalReportActions = {mount};
})(window);
