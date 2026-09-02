// ==UserScript==
// @name         4chan Fully Integrated Captcha Assistant
// @namespace    4chan-userscripts
// @version      1.1.0
// @description  Replaces 4chan's native reply form with a single custom panel: comment/name/file fields, the captcha assistant embedded inline, and direct submission.
// @match        https://boards.4chan.org/*
// @match        https://boards.4channel.org/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-fully-integrated-captcha-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-fully-integrated-captcha-assistant.user.js
// ==/UserScript==

// This is the "fully integrated" sibling of 4chan-captcha-assistant.user.js —
// that script stays untouched as the minimal, non-form-replacing option.
// This one hides 4chan's native reply form entirely and replaces it with one
// panel that handles composing, attaching, captcha-solving, and submitting.
// The captcha-rendering logic here (state machine, TCaptcha patch, image
// grid) is carried over from the minimal script largely unchanged — it's
// duplicated rather than shared via @require so this stays a single
// self-contained installable file, same as the original.
//
// v1 scope: reply-to-thread only (no new-thread creation), no persisted
// identity, no multi-post queue, no drag-drop/paste file attach.

(function () {
  'use strict';

  // --- board/thread detection (same derivation 4chan-X's QR module uses) ---

  function getBoardAndThreadFromURL() {
    const parts = location.pathname.split(/\/+/).filter(Boolean);
    const board = parts[0];
    const threadID = parts[1] === 'thread' ? Number(parts[2]) : null;
    return { board, threadID };
  }

  const { board, threadID } = getBoardAndThreadFromURL();

  // Reply-to-thread only for v1 — on board index/catalog pages (no thread ID)
  // this script does nothing at all, leaving the native "Start a Thread"
  // form fully intact rather than hiding it with no replacement.
  if (!board || !threadID) return;

  // --- styles ----------------------------------------------------------------

  const STYLE = `
    #postForm {
      display: none !important;
    }

    #fica-panel {
      position: fixed;
      bottom: 16px;
      right: 16px;
      width: clamp(280px, 26vw, 420px);
      max-height: 80vh;
      min-width: 260px;
      min-height: 200px;
      max-width: 90vw;
      resize: both;
      overflow: auto;
      box-sizing: border-box;
      padding: 8px;
      font-family: sans-serif;
      color: #ddd;
      background: #262b33;
      border: 1px solid #333c48;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
      z-index: 999999;
    }

    #fica-panel[hidden] {
      display: none;
    }

    .fica-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #333c48;
      cursor: move;
      user-select: none;
    }

    .fica-title {
      font-size: 12px;
      font-weight: bold;
      color: #e0e4ea;
      white-space: nowrap;
    }

    .fica-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .fica-close-btn {
      border: none;
      background: transparent;
      color: #9aa5b1;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      cursor: pointer;
    }

    .fica-close-btn:hover {
      color: #e74c3c;
    }

    .fica-timer {
      font-size: 12px;
      font-weight: bold;
      text-align: right;
      color: #8fa3bf;
    }

    .fica-timer.low {
      color: #e74c3c;
    }

    .fica-field {
      margin-bottom: 8px;
    }

    .fica-field label {
      display: block;
      font-size: 11px;
      color: #9aa5b1;
      margin-bottom: 2px;
    }

    .fica-name-input,
    .fica-comment-input {
      box-sizing: border-box;
      width: 100%;
      background: #1c2027;
      color: #ddd;
      border: 1px solid #333c48;
      border-radius: 4px;
      padding: 4px 6px;
      font-family: inherit;
      font-size: 12px;
    }

    .fica-comment-input {
      resize: vertical;
      min-height: 60px;
    }

    .fica-file-field {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .fica-file-btn {
      border: 1px solid #333c48;
      background: #1c2027;
      color: #ddd;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }

    .fica-file-name {
      font-size: 11px;
      color: #9aa5b1;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .fica-file-remove {
      border: none;
      background: transparent;
      color: #9aa5b1;
      cursor: pointer;
      font-size: 14px;
    }

    .fica-file-remove:hover {
      color: #e74c3c;
    }

    .fica-captcha-section {
      margin: 8px 0;
      padding: 6px;
      border: 1px solid #333c48;
      border-radius: 6px;
    }

    .fica-captcha-native-wrap {
      /* TCaptcha.init() does container.className = "" on the element we
         hand it (clears whatever class we put there) and sets a pile of its
         own inline styles besides — so hiding has to target a WRAPPER that
         TCaptcha never touches, not the element itself, or the hiding rule
         stops matching the instant init() runs. The real widget still gets
         initialized inside; sendSelection() drives its sliderNode/
         onNextClick() directly and its iframe still fetches/verifies
         challenges normally — none of that depends on being visible, this
         just keeps its raw one-at-a-time slider UI out of the way in favor
         of the grid below. */
      display: none !important;
    }

    /* Two-class compound selector beats the single-class rule above on
       specificity regardless of source order, so this reliably wins while
       active — used to temporarily reveal the real widget when an
       interactive verification (e.g. Cloudflare) needs the user directly. */
    .fica-captcha-native-wrap.fica-force-show {
      display: block !important;
    }

    .fica-captcha-controls {
      display: flex;
      justify-content: flex-start;
      margin-bottom: 8px;
    }

    .fica-get-captcha-btn {
      border: 1px solid #333c48;
      background: #1c2027;
      color: #ddd;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }

    /* :hover matches purely on pointer position, independent of :disabled —
       scoping it to :not(:disabled) so a disabled button doesn't visually
       highlight, and it comes back automatically (no JS needed) once
       re-enabled since it's a live selector, not a JS-applied class. */
    .fica-get-captcha-btn:not(:disabled):hover {
      background: #262b33;
    }

    .fica-get-captcha-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .fica-captcha-prompt {
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
    }

    .fica-captcha-prompt img {
      display: block;
      max-width: 100%;
      max-height: 22vh;
      width: auto;
      height: auto;
      margin: 0 auto 6px;
    }

    .fica-captcha-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .fica-captcha-grid.done {
      opacity: 0.4;
    }

    .fica-thumb-row {
      position: relative;
    }

    .fica-thumb {
      display: block;
      max-width: 100%;
      max-height: 22vh;
      width: auto;
      height: auto;
      margin: 0 auto;
      border-radius: 4px;
      border: 2px solid transparent;
      box-sizing: border-box;
      background-color: rgb(238, 238, 238);
      cursor: pointer;
    }

    /* Single unified indicator for "the current candidate" — same class,
       same color, regardless of whether it got there by click or by
       keyboard nav. Double-click or Enter/Space sends whichever one this
       is currently on. */
    .fica-thumb.focused {
      border-color: #2ecc71;
    }

    .fica-captcha-hint {
      font-size: 11px;
      color: #8a94a3;
      margin-bottom: 6px;
    }

    .fica-captcha-status {
      margin-top: 6px;
      font-size: 12px;
      color: #9c9;
    }

    .fica-submit-btn {
      width: 100%;
      padding: 8px;
      border: none;
      border-radius: 4px;
      background: #c0392b;
      color: #fff;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }

    .fica-submit-btn:not(:disabled):hover {
      background: #e74c3c;
    }

    .fica-submit-btn:disabled {
      background: #555;
      cursor: default;
    }

    .fica-form-status {
      margin-top: 6px;
      font-size: 12px;
      min-height: 14px;
    }

    .fica-form-status.error {
      color: #e74c3c;
    }

    .fica-form-status.success {
      color: #2ecc71;
    }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  // --- panel DOM ---------------------------------------------------------

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'fica-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="fica-header">
        <span class="fica-title">Fully Integrated Captcha Assistant</span>
        <div class="fica-header-right">
          <div class="fica-timer"></div>
          <button type="button" class="fica-close-btn" title="Close">&times;</button>
        </div>
      </div>
      <div class="fica-field">
        <label>Name (optional)</label>
        <input type="text" class="fica-name-input" />
      </div>
      <div class="fica-field">
        <label>Comment</label>
        <textarea class="fica-comment-input" rows="4"></textarea>
      </div>
      <div class="fica-field fica-file-field">
        <button type="button" class="fica-file-btn">Attach file</button>
        <span class="fica-file-name"></span>
        <button type="button" class="fica-file-remove" hidden title="Remove file">&times;</button>
        <input type="file" class="fica-file-input" hidden />
      </div>
      <div class="fica-captcha-section">
        <div class="fica-captcha-native-wrap"><div class="fica-captcha-native"></div></div>
        <div class="fica-captcha-controls">
          <button type="button" class="fica-get-captcha-btn">Get Captcha</button>
        </div>
        <div class="fica-captcha-hint">Double-click an image, or use ↑/↓ (W/S) + Enter/Space, to answer.</div>
        <div class="fica-captcha-prompt"></div>
        <div class="fica-captcha-grid"></div>
        <div class="fica-captcha-status"></div>
      </div>
      <button type="button" class="fica-submit-btn">Submit</button>
      <div class="fica-form-status"></div>
    `;
    document.body.appendChild(panel);
    return {
      root: panel,
      header: panel.querySelector('.fica-header'),
      timer: panel.querySelector('.fica-timer'),
      closeBtn: panel.querySelector('.fica-close-btn'),
      nameInput: panel.querySelector('.fica-name-input'),
      commentInput: panel.querySelector('.fica-comment-input'),
      fileBtn: panel.querySelector('.fica-file-btn'),
      fileName: panel.querySelector('.fica-file-name'),
      fileRemove: panel.querySelector('.fica-file-remove'),
      fileInput: panel.querySelector('.fica-file-input'),
      captchaNativeWrap: panel.querySelector('.fica-captcha-native-wrap'),
      captchaNative: panel.querySelector('.fica-captcha-native'),
      getCaptchaBtn: panel.querySelector('.fica-get-captcha-btn'),
      captchaPrompt: panel.querySelector('.fica-captcha-prompt'),
      captchaGrid: panel.querySelector('.fica-captcha-grid'),
      captchaStatus: panel.querySelector('.fica-captcha-status'),
      submitBtn: panel.querySelector('.fica-submit-btn'),
      formStatus: panel.querySelector('.fica-form-status'),
    };
  }

  injectStyle();
  const el = buildPanel();

  // --- position persistence + dragging (same pattern as the minimal script) --

  const POSITION_STORAGE_KEY = 'fully-integrated-captcha-assistant:position';

  function loadSavedPosition() {
    try {
      const raw = localStorage.getItem(POSITION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.left === 'number' && typeof parsed.top === 'number') return parsed;
    } catch (err) {
      // ignore malformed/missing storage
    }
    return null;
  }

  function savePosition() {
    const rect = el.root.getBoundingClientRect();
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
    } catch (err) {
      // storage unavailable — position just won't persist
    }
  }

  function applySavedPosition() {
    const pos = loadSavedPosition();
    if (!pos) return;
    el.root.style.left = `${pos.left}px`;
    el.root.style.top = `${pos.top}px`;
    el.root.style.right = 'auto';
    el.root.style.bottom = 'auto';
  }

  function clampToViewport() {
    if (el.root.hidden) return;
    const rect = el.root.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    const left = Math.min(Math.max(rect.left, 0), maxLeft);
    const top = Math.min(Math.max(rect.top, 0), maxTop);
    if (left !== rect.left || top !== rect.top) {
      el.root.style.left = `${left}px`;
      el.root.style.top = `${top}px`;
      el.root.style.right = 'auto';
      el.root.style.bottom = 'auto';
    }
  }

  function makeDraggable(handle, target) {
    handle.addEventListener('mousedown', (downEvent) => {
      if (downEvent.target.closest('.fica-close-btn')) return;
      downEvent.preventDefault();

      const rect = target.getBoundingClientRect();
      target.style.left = `${rect.left}px`;
      target.style.top = `${rect.top}px`;
      target.style.right = 'auto';
      target.style.bottom = 'auto';

      const startX = downEvent.clientX;
      const startY = downEvent.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;

      function onMouseMove(moveEvent) {
        const maxLeft = Math.max(0, window.innerWidth - target.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - target.offsetHeight);
        const newLeft = Math.min(Math.max(startLeft + (moveEvent.clientX - startX), 0), maxLeft);
        const newTop = Math.min(Math.max(startTop + (moveEvent.clientY - startY), 0), maxTop);
        target.style.left = `${newLeft}px`;
        target.style.top = `${newTop}px`;
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        savePosition();
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  applySavedPosition();
  makeDraggable(el.header, el.root);

  // --- panel open/close, wired to the native reply link -------------------

  let panelOpen = false;

  // window.TCaptcha may not exist yet the first time the panel opens (4chan's
  // own captcha script can load asynchronously) — this is called both here
  // and once patchTCaptchaOnceReady's poll actually finds it, so the captcha
  // box gets initialized into our container whichever happens second.
  function ensureCaptchaInitialized() {
    const t = window.TCaptcha;
    if (!t || typeof t.init !== 'function') return;
    if (t.node === el.captchaNative) return; // already ours
    t.init(el.captchaNative, board, threadID, undefined, true);
    syncGetCaptchaButton();
  }

  // Mirrors the real (hidden) reloadNode's disabled/text state onto our own
  // visible button instead of reimplementing the cooldown timing ourselves —
  // toggleReloadBtn() is the one low-level function every state change
  // (Loading, disabled, re-enabled) funnels through, and onReloadCdTick()
  // is what actually updates the per-second countdown text directly. This
  // stays correct even for edge cases in TCaptcha's own timing we wouldn't
  // otherwise know about (e.g. it zeroes the remaining wait early if a
  // "_ev1" cookie is present).
  function syncGetCaptchaButton() {
    const t = window.TCaptcha;
    if (!t || !t.reloadNode) return;
    // A verification-pending disable is explicit and must never get
    // silently overwritten by a stale mirror read.
    if (verificationPending) {
      el.getCaptchaBtn.disabled = true;
      return;
    }
    el.getCaptchaBtn.disabled = t.reloadNode.disabled;
    el.getCaptchaBtn.textContent = t.reloadNode.textContent || 'Get Captcha';
  }

  // Belt-and-suspenders on top of the toggleReloadBtn/onReloadCdTick hooks
  // below: keeps re-syncing on a plain interval regardless of which native
  // code path actually changed reloadNode's state, in case some update to
  // TCaptcha's own script ever reassigns one of those methods after we've
  // already wrapped it (wrapping only ever patches whatever's assigned at
  // the moment we look).
  setInterval(syncGetCaptchaButton, 400);

  // The real "Get Captcha" button lives inside the native widget we hide
  // (.fica-captcha-native-wrap), so there's no way left to trigger it — this
  // forwards to that real button rather than calling TCaptcha.onReloadClick()
  // ourselves, so its own disabled/cooldown state (set via toggleReloadBtn())
  // is respected for free: clicking a disabled button via .click() is a
  // no-op, same as it would be for a real user.
  el.getCaptchaBtn.addEventListener('click', () => {
    // Explicit guard, not just relying on the disabled attribute alone —
    // this button's disabled state is set from several different places
    // (mirrored from the real button, and explicitly during a pending
    // verification), so double-check here rather than trust any one of
    // them individually.
    if (el.getCaptchaBtn.disabled) return;
    const t = window.TCaptcha;
    if (t && t.reloadNode) {
      t.reloadNode.click();
    } else {
      setCaptchaStatus('Captcha not ready yet — try again in a moment.');
    }
  });

  function openPanel() {
    panelOpen = true;
    el.root.hidden = false;
    clampToViewport();
    ensureCaptchaInitialized();
  }

  function closePanel() {
    panelOpen = false;
    el.root.hidden = true;
  }

  function togglePanel() {
    if (el.root.hidden) openPanel();
    else closePanel();
  }

  el.closeBtn.addEventListener('click', () => closePanel());

  const replyLink = document.getElementById('togglePostFormLink');
  if (replyLink) {
    replyLink.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel();
      },
      true
    );
  }

  // --- quoting: click a post's quote link to open the panel, prefilled ----
  //
  // Confirmed against 4chan-X's own source (which has to find this same
  // element to enhance it) that the real native quote link is the *second*
  // anchor inside `.postNum` — the first is just the "No." highlight link.
  // For a same-thread reply it's an `href="javascript:quote('<id>')"`, which
  // is why we can't just read the href as a normal URL; cross-thread quote
  // links use a plain `#q<id>` URL instead and are deliberately left alone
  // here (real navigation to another thread, not something this v1 opens a
  // panel for).

  let lastSelectedText = '';

  // Selection is typically already collapsed by the time a *later* click's
  // own mousedown fires, so the freshest non-empty selection has to be
  // cached on mouseup and reused, rather than re-read at click time.
  document.addEventListener('mouseup', () => {
    const text = window.getSelection().toString().trim();
    if (text) lastSelectedText = text;
  });

  function buildQuoteText(postID) {
    let text = `>>${postID}\n`;
    const freshSelection = window.getSelection().toString().trim();
    const selected = freshSelection || lastSelectedText;
    if (selected) {
      const quotedLines = selected
        .split('\n')
        .map((line) => `>${line.trim()}`)
        .join('\n');
      text += `${quotedLines}\n`;
      lastSelectedText = ''; // consumed — don't reapply to a later, unrelated quote click
    }
    return text;
  }

  function insertQuote(postID) {
    const quoteText = buildQuoteText(postID);
    const existing = el.commentInput.value;
    el.commentInput.value = existing && !existing.endsWith('\n') ? `${existing}\n${quoteText}` : existing + quoteText;
    el.commentInput.focus();
    el.commentInput.selectionStart = el.commentInput.selectionEnd = el.commentInput.value.length;
  }

  document.addEventListener(
    'click',
    (e) => {
      const link = e.target.closest('a');
      if (!link || !link.matches('.postNum > a:nth-of-type(2)')) return;
      const href = link.getAttribute('href') || '';
      const match = href.match(/quote\('(\d+)'\)/);
      if (!match) return; // cross-thread quote link — let the real navigation happen
      e.preventDefault();
      e.stopPropagation();
      openPanel();
      insertQuote(match[1]);
    },
    true
  );

  // --- file attach ---------------------------------------------------------

  let selectedFile = null;

  el.fileBtn.addEventListener('click', () => el.fileInput.click());

  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files && el.fileInput.files[0];
    if (!file) return;
    selectedFile = file;
    el.fileName.textContent = file.name;
    el.fileRemove.hidden = false;
  });

  el.fileRemove.addEventListener('click', () => {
    selectedFile = null;
    el.fileInput.value = '';
    el.fileName.textContent = '';
    el.fileRemove.hidden = true;
  });

  // --- captcha state (ported from 4chan-captcha-assistant.user.js) --------

  const DEFAULT_CAPTCHA_TTL_SECONDS = 120;
  const LOW_TIME_THRESHOLD_SECONDS = 20;

  const captchaState = {
    tasks: [],
    currentTaskId: 0,
    currentItemIndex: 0,
  };

  let expiryTimestamp = null;
  let timerIntervalId = null;

  function setCaptchaStatus(text) {
    el.captchaStatus.textContent = text;
  }

  function updateTimerDisplay() {
    if (!expiryTimestamp) return;
    const remainingMs = expiryTimestamp - Date.now();
    if (remainingMs <= 0) {
      el.timer.textContent = '0:00';
      el.timer.classList.add('low');
      stopTimer();
      return;
    }
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    el.timer.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    el.timer.classList.toggle('low', totalSeconds <= LOW_TIME_THRESHOLD_SECONDS);
  }

  function startTimer(ttlSeconds) {
    stopTimer();
    const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : DEFAULT_CAPTCHA_TTL_SECONDS;
    expiryTimestamp = Date.now() + ttl * 1000;
    updateTimerDisplay();
    timerIntervalId = setInterval(updateTimerDisplay, 250);
  }

  function stopTimer() {
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
    expiryTimestamp = null;
    el.timer.textContent = '';
    el.timer.classList.remove('low');
  }

  // There's a single "current" candidate (captchaState.currentItemIndex) —
  // click or arrow-key nav both just move it, with one shared highlight.
  // Double-click or Enter/Space sends whichever one is current; there's no
  // separate "selected, now hit Send" step or state.

  function focusItem(itemIndex) {
    captchaState.currentItemIndex = itemIndex;
    applyFocusHighlight();
  }

  function selectAndSend(itemIndex) {
    focusItem(itemIndex);
    sendSelection();
  }

  function sendSelection() {
    if (!captchaState.currentItemIndex) return;
    const t = window.TCaptcha;
    if (!t || !t.sliderNode) return;
    if (captchaState.currentTaskId !== t.taskId) return;
    t.sliderNode.value = captchaState.currentItemIndex;
    t.onSliderInput();
    t.onNextClick();
  }

  function renderCurrentTask() {
    const task = captchaState.tasks[captchaState.currentTaskId];
    el.captchaGrid.innerHTML = '';
    el.captchaGrid.classList.remove('done');
    el.captchaPrompt.innerHTML = '';

    if (!task) return;

    if (task.str) {
      el.captchaPrompt.innerHTML = task.str;
    } else if (task.img) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${task.img}`;
      el.captchaPrompt.appendChild(img);
    }

    (task.items || []).forEach((item, index) => {
      const itemIndex = index + 1;

      const row = document.createElement('div');
      row.className = 'fica-thumb-row';

      const img = document.createElement('img');
      img.className = 'fica-thumb';
      img.src = `data:image/png;base64,${item}`;
      if (itemIndex === captchaState.currentItemIndex) {
        img.classList.add('focused');
      }
      img.addEventListener('click', () => focusItem(itemIndex));
      img.addEventListener('dblclick', () => selectAndSend(itemIndex));

      row.appendChild(img);
      el.captchaGrid.appendChild(row);
    });

    setCaptchaStatus(`Task ${captchaState.currentTaskId + 1} of ${captchaState.tasks.length}`);
  }

  function applyFocusHighlight() {
    const thumbs = el.captchaGrid.querySelectorAll('.fica-thumb');
    thumbs.forEach((thumb, index) => {
      thumb.classList.toggle('focused', index + 1 === captchaState.currentItemIndex);
    });
  }

  // --- keyboard navigation -------------------------------------------------
  //
  // Up/Down (or W/S) move the focus highlight across the current task's
  // thumbnails; Enter/Space selects and sends the focused one. Scoped to
  // only fire while the panel is open and the user isn't typing in this
  // panel's own name/comment fields (or anywhere else) — this panel replaces
  // the native reply form, so its comment textarea is the thing arrows/
  // space/enter would otherwise land in.

  function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  function moveFocus(delta) {
    const task = captchaState.tasks[captchaState.currentTaskId];
    const itemCount = task && task.items ? task.items.length : 0;
    if (itemCount === 0) return;
    const next = Math.min(Math.max(captchaState.currentItemIndex + delta, 1), itemCount);
    if (next === captchaState.currentItemIndex) return;
    captchaState.currentItemIndex = next;
    applyFocusHighlight();
  }

  document.addEventListener('keydown', (event) => {
    if (el.root.hidden) return;
    if (isTypingTarget(event.target)) return;
    if (!captchaState.tasks.length) return;

    switch (event.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        selectAndSend(captchaState.currentItemIndex);
        break;
      default:
        break;
    }
  });

  function resetCaptchaSection() {
    captchaState.tasks = [];
    captchaState.currentTaskId = 0;
    captchaState.currentItemIndex = 0;
    el.captchaGrid.innerHTML = '';
    el.captchaPrompt.innerHTML = '';
    el.captchaStatus.textContent = '';
    stopTimer();
  }

  function onCaptchaLoading() {
    resetCaptchaSection();
    setCaptchaStatus('Loading captcha…');
  }

  function onChallengeReady(challenge, tasks, ttl) {
    captchaState.tasks = tasks || [];
    captchaState.currentTaskId = 0;
    captchaState.currentItemIndex = 0;
    renderCurrentTask();
    startTimer(ttl);
  }

  function onTaskChanged(taskId) {
    captchaState.currentTaskId = taskId;
    captchaState.currentItemIndex = 0;
    renderCurrentTask();
  }

  function onItemFocused(itemIndex) {
    captchaState.currentItemIndex = itemIndex;
    applyFocusHighlight();
  }

  function onDone() {
    setCaptchaStatus('All tasks complete — ready to submit.');
    el.captchaGrid.classList.add('done');
  }

  // Covers messages like "Please wait a while before making a thread or
  // verify your email..." and its "You can now request a captcha." follow-up
  // — TCaptcha sends these through the same content channel as task prompts,
  // just with no active challenge behind them (no candidate images to grid).
  function onStatusMessage(content) {
    if (!content) return;
    el.captchaGrid.innerHTML = '';
    el.captchaGrid.classList.remove('done');
    el.captchaPrompt.innerHTML = content;
  }

  function onNoVerificationNeeded() {
    el.captchaGrid.innerHTML = '';
    el.captchaPrompt.innerHTML = '';
    setCaptchaStatus('Verification not required.');
    stopTimer();
  }

  function onExpired() {
    setCaptchaStatus('Captcha expired — click Get Captcha again.');
    stopTimer();
    el.timer.textContent = 'Expired';
    el.timer.classList.add('low');
  }

  function onCaptchaCleared() {
    resetCaptchaSection();
  }

  // --- interactive verification (e.g. Cloudflare) detection ---------------
  //
  // Sometimes the captcha iframe comes back with an interactive Cloudflare
  // challenge instead of a normal response. That page runs entirely inside
  // the iframe (cross-origin — sys.4chan.org vs boards.4chan.org — so we
  // can't read its content to detect this directly) and never calls
  // TCaptcha's own postMessage-driven methods until the user completes it,
  // which can take a while. Heuristic: TCaptcha.load() starts a request: if
  // none of the normal "a response arrived" hooks fire within a few seconds,
  // assume the user needs to interact with the iframe directly and reveal
  // the real captcha UI (this script hides it unconditionally otherwise) so
  // they can. Once a real response does arrive — per testing, this shows up
  // as a long setReloadCd() cooldown (the same "please wait ~5 minutes"
  // flow) — hide it again.

  const VERIFICATION_CHECK_DELAY_MS = 6000;

  let verificationCheckTimeoutId = null;
  let verificationPending = false;

  function armVerificationCheck() {
    if (verificationCheckTimeoutId) clearTimeout(verificationCheckTimeoutId);
    verificationCheckTimeoutId = setTimeout(() => {
      verificationCheckTimeoutId = null;
      onVerificationNeeded();
    }, VERIFICATION_CHECK_DELAY_MS);
  }

  // Called from every hook that means "a real response arrived" — cancels
  // the stuck-check timer, and re-hides the native UI if we'd revealed it.
  function markResponseArrived() {
    if (verificationCheckTimeoutId) {
      clearTimeout(verificationCheckTimeoutId);
      verificationCheckTimeoutId = null;
    }
    if (verificationPending) {
      verificationPending = false;
      el.captchaNativeWrap.classList.remove('fica-force-show');
      // Re-sync rather than just re-enabling — a fresh reload cooldown may
      // have started at the same time the response arrived.
      syncGetCaptchaButton();
    }
  }

  function onVerificationNeeded() {
    verificationPending = true;
    el.captchaNativeWrap.classList.add('fica-force-show');
    setCaptchaStatus('Additional verification required — please complete it above, then wait a moment.');
    // Explicit, guaranteed disable for the whole verification window rather
    // than relying solely on the mirrored native state, which is what was
    // actually clicked to get here and could otherwise look re-enabled.
    el.getCaptchaBtn.disabled = true;
  }

  // --- TCaptcha patch (own guard flag, distinct from the minimal script's, --
  // --- so both scripts can be installed together without conflicting) ------

  function patchTCaptchaOnceReady() {
    const t = window.TCaptcha;
    if (!t || t.__fullyIntegratedPatched) return Boolean(t);
    t.__fullyIntegratedPatched = true;

    function wrap(name, handler) {
      const original = t[name];
      if (typeof original !== 'function') return;
      t[name] = function (...args) {
        const result = original.apply(this, args);
        try {
          handler(args, result);
        } catch (err) {
          // never let our own instrumentation break the real captcha flow
        }
        return result;
      };
    }

    wrap('onReloadClick', () => onCaptchaLoading());

    // load() is what actually starts a request and creates the iframe —
    // arm the stuck-check here so it covers every path that fetches a
    // challenge (onReloadClick calls this internally too).
    wrap('load', () => armVerificationCheck());

    wrap('setChallenge', (args) => {
      markResponseArrived();
      const data = args[0] || {};
      onChallengeReady(data.challenge, data.tasks || [], data.ttl);
    });

    wrap('setTaskId', (args) => onTaskChanged(args[0]));
    wrap('setTaskItem', (args) => onItemFocused(args[0]));
    wrap('setNoop', () => {
      markResponseArrived();
      onNoVerificationNeeded();
    });
    wrap('onChallengeExpired', () => {
      markResponseArrived();
      onExpired();
    });
    wrap('clearChallenge', () => onCaptchaCleared());

    // Fires for the normal short post-fetch cooldown AND for the much
    // longer "please wait before making a thread / verify your email" wait
    // (seen up to ~5 minutes) — same underlying mechanism either way, so
    // just show a countdown regardless of which triggered it. If a real
    // challenge is also on its way, setChallenge()'s startTimer(ttl) call
    // fires after this one in TCaptcha's own source and correctly wins.
    // The header timer is exclusively for "when does the challenge I'm
    // looking at expire" now — the reload cooldown (30s normal, up to ~5min
    // for the "please wait" case) is mirrored onto our own Get Captcha
    // button below instead, via toggleReloadBtn/onReloadCdTick.
    wrap('setReloadCd', () => markResponseArrived());

    wrap('toggleReloadBtn', () => syncGetCaptchaButton());
    wrap('onReloadCdTick', () => syncGetCaptchaButton());

    wrap('setTaskNodeContent', (args) => {
      markResponseArrived();
      const content = args[0];
      const isImage = args[1];
      if (isImage) return; // candidate images are already covered via challenge-ready's full task data
      if (content === 'Done.') {
        onDone();
        return;
      }
      onStatusMessage(content);
    });

    return true;
  }

  if (!patchTCaptchaOnceReady()) {
    const poll = setInterval(() => {
      if (patchTCaptchaOnceReady()) {
        clearInterval(poll);
        if (panelOpen) ensureCaptchaInitialized();
      }
    }, 500);
  }

  // --- deletion password ---------------------------------------------------

  function getOrCreateDeletePassword() {
    const cookieMatch = document.cookie.match(/(?:^|;\s*)4chan_pass=([^;]+)/);
    if (cookieMatch) return decodeURIComponent(cookieMatch[1]);

    const KEY = 'fully-integrated-captcha-assistant:delete-password';
    let pwd = null;
    try {
      pwd = localStorage.getItem(KEY);
    } catch (err) {
      // ignore
    }
    if (!pwd) {
      pwd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      try {
        localStorage.setItem(KEY, pwd);
      } catch (err) {
        // storage unavailable — password just won't persist across sessions
      }
    }
    return pwd;
  }

  // --- submission ------------------------------------------------------------

  const MAX_FILE_SIZE_BYTES = 4194304; // 4chan's default max_filesize; informational field only, not enforced client-side

  function setFormStatus(text, kind) {
    el.formStatus.textContent = text;
    el.formStatus.classList.remove('error', 'success');
    if (kind) el.formStatus.classList.add(kind);
  }

  // 4chan's own thread auto-updater doesn't know about a post submitted via
  // our own direct fetch() until its next poll cycle, so the new post's DOM
  // node may not exist yet the instant submitPost() resolves — poll briefly
  // for it (4chan posts are id="p<postID>") and scroll to it once it shows
  // up, falling back to the bottom of the page if it never appears in time.
  function scrollToNewPost(postID) {
    // 4chan's auto-updater is often slow to pick up a post submitted via our
    // own direct fetch() — don't make the user wait on it. Scroll to the
    // bottom right away as the guaranteed baseline, then upgrade to the
    // exact post (scrolled to center) if/when it shows up shortly after.
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

    if (!postID) return;

    const maxAttempts = 10;
    let attempts = 0;
    const tryFindPost = () => {
      const postEl = document.getElementById(`p${postID}`);
      if (postEl) {
        postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) setTimeout(tryFindPost, 500);
    };
    setTimeout(tryFindPost, 500);
  }

  async function submitPost({ name, comment, file }) {
    const t = window.TCaptcha;
    const formData = new FormData();
    formData.append('MAX_FILE_SIZE', String(MAX_FILE_SIZE_BYTES));
    formData.append('mode', 'regist');
    formData.append('pwd', getOrCreateDeletePassword());
    formData.append('resto', String(threadID));
    if (name) formData.append('name', name);
    formData.append('com', comment);
    if (file) formData.append('upfile', file, file.name);
    if (t && t.challengeIdNode) formData.append('t-challenge', t.challengeIdNode.value);
    if (t && t.respNode) formData.append('t-response', t.respNode.value);

    const domainPart = location.hostname.split('.')[1]; // '4chan' or '4channel'
    const url = `https://sys.${domainPart}.org/${board}/post`;

    const res = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const errmsg = doc.getElementById('errmsg');
    if (errmsg) return { ok: false, error: errmsg.textContent };
    if (doc.title !== 'Post successful!') return { ok: false, error: `Unexpected response (status ${res.status})` };

    const match = doc.body.textContent.match(/thread:(\d+),no:(\d+)/);
    return { ok: true, threadID: match && match[1], postID: match && match[2] };
  }

  el.submitBtn.addEventListener('click', async () => {
    const name = el.nameInput.value.trim();
    const comment = el.commentInput.value.trim();

    if (!comment && !selectedFile) {
      setFormStatus('Comment or file required.', 'error');
      return;
    }

    el.submitBtn.disabled = true;
    setFormStatus('Posting…');

    try {
      const result = await submitPost({ name, comment, file: selectedFile });
      if (result.ok) {
        setFormStatus('Posted.', 'success');
        el.commentInput.value = '';
        selectedFile = null;
        el.fileInput.value = '';
        el.fileName.textContent = '';
        el.fileRemove.hidden = true;
        resetCaptchaSection();
        closePanel();
        scrollToNewPost(result.postID);
      } else {
        setFormStatus(result.error || 'Post failed.', 'error');
      }
    } catch (err) {
      setFormStatus(`Request failed: ${err.message}`, 'error');
    } finally {
      el.submitBtn.disabled = false;
    }
  });
})();
