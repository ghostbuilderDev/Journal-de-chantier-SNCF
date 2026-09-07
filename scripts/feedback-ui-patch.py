#!/usr/bin/env python3
"""Add the feedback entry points without replacing an installed app version.

The release installer validates the original/derived hashes separately. These
edits are deliberately narrow and never alter the existing chantier modules.
"""
import re

VERSION = '14.5-retours'
APP_HOOK = '''  // JournalFeedback V14.5: independent global feedback space.
  const feedback = window.JournalFeedback?.create({
    getContext: () => ({ ready: isCloudReady(), userId: app.user?.id || null,
      db: app.db, profileName: app.profile?.full_name || "" }),
    toast
  });

'''
ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h5"/></svg>'
SIDEBAR = ('      <button class="sidebar-directory-button feedback-entry" id="sidebarFeedbackBtn" type="button" hidden>'
           + ICON + '<span>Améliorer l’application<small>Idées et problèmes rencontrés</small></span></button>\n\n')
TOPBAR = ('          <button class="tool-button hide-small feedback-topbar" id="feedbackBtn" type="button" '
          'title="Améliorer l’application : espace commun à tous les utilisateurs" hidden>'
          + ICON + '<span>Améliorer l’application</span></button>\n')


def once(source, needle, replacement):
    if source.count(needle) != 1:
        raise ValueError('Point de branchement du fil de retours absent ou ambigu ; fichiers conservés.')
    return source.replace(needle, replacement, 1)


def patch_file(name, value):
    source = value.decode('utf-8')
    if name == 'app-v13.js':
        if '// JournalFeedback V14.5:' in source:
            return value
        hook = APP_HOOK
        if '  const modeChantier = window.JournalModeChantier?.create({' in source:
            hook = hook.replace('    toast\n', '    toast,\n    onVisibilityChange: () => modeChantier?.presence()\n')
        source = once(source, '  function defaultLocalData() {', hook + '  function defaultLocalData() {')
        source = once(source, '  function clearSessionPrivateState() {',
                      '  function clearSessionPrivateState() {\n    if (typeof feedback !== "undefined") feedback?.clear();')
        source = once(source, '  function renderAll(options) {',
                      '  function renderAll(options) { if (typeof feedback !== "undefined") feedback?.contextChanged();')
        # This hook exists only if Mode chantier is installed. Avoid navigating
        # behind an open feedback dialog when a notification is clicked.
        overlay = 'isOverlayOpen: () => !els.modalBackdrop.hidden || !els.photoViewer.hidden,'
        if overlay in source:
            source = once(source, overlay,
                          'isOverlayOpen: () => !els.modalBackdrop.hidden || !els.photoViewer.hidden || Boolean(feedback?.isOpen()),')
        source, count = re.subn(r'service-worker-v13\.js\?v=[A-Za-z0-9.\-]+',
                               'service-worker-v13.js?v=' + VERSION, source)
        if count != 1:
            raise ValueError('Enregistrement du service worker inconnu ; fichiers conservés.')
    elif name == 'index.html':
        if 'id="sidebarFeedbackBtn"' in source:
            return value
        source = once(source, '      <div class="section-label"><span>MES CHANTIERS</span>',
                      SIDEBAR + '      <div class="section-label"><span>MES CHANTIERS</span>')
        source = once(source, '        <div class="topbar-tools">', '        <div class="topbar-tools">\n' + TOPBAR.rstrip('\n'))
        source, count = re.subn(r'  <script src="app-v13\.js\?v=[A-Za-z0-9.\-]+" defer></script>',
                               f'  <link rel="stylesheet" href="feedback.css?v={VERSION}" media="screen">\n'
                               f'  <script src="feedback.js?v={VERSION}" defer></script>\n'
                               f'  <script src="app-v13.js?v={VERSION}" defer></script>', source)
        if count != 1:
            raise ValueError('Chargement de l’application inconnu ; fichiers conservés.')
    elif name == 'service-worker-v13.js':
        if "feedback.js?v=" + VERSION in source:
            return value
        source, count = re.subn(r'''const CACHE_NAME = (["'])journal-chantier-connecte-[^"']+\1;''',
                               "const CACHE_NAME = 'journal-chantier-connecte-v14.5-retours';", source)
        if count != 1:
            raise ValueError('Cache de l’application inconnu ; fichiers conservés.')
        source = once(source, 'const APP_SHELL = [',
                      f"const APP_SHELL = [\n  './feedback.js?v={VERSION}', './feedback.css?v={VERSION}',")
        source, count = re.subn(r'app-v13\.js\?v=[A-Za-z0-9.\-]+', 'app-v13.js?v=' + VERSION, source)
        if count != 1:
            raise ValueError('Application du cache inconnue ; fichiers conservés.')
    else:
        raise ValueError('Fichier non prévu pour ce branchement.')
    return source.encode('utf-8')
