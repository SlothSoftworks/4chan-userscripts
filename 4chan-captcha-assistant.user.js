// ==UserScript==
// @name         4chan Captcha Assistant
// @namespace    4chan-userscripts
// @version      1.2.0
// @description  Preloads all TCaptcha candidate images for the current task and displays them together, with click-to-select.
// @match        https://boards.4chan.org/*
// @match        https://boards.4channel.org/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-assistant.user.js
// ==/UserScript==

// With @grant none this script runs directly in the page's own JS world, so
// window.TCaptcha is just... there. Every wrap handler below calls the
// render functions directly — no injection trick or message-passing needed.

(function () {
  'use strict';

  // --- widget DOM + styles ---------------------------------------------------

  const STYLE = `
    #captcha-assistant-widget {
      position: fixed;
      bottom: 16px;
      right: 16px;
      /* Relative to viewport so it doesn't feel oversized/undersized on
         different screens, bounded so it stays reasonable either way. */
      width: clamp(240px, 22vw, 380px);
      max-height: 70vh;
      min-width: 220px;
      min-height: 150px;
      max-width: 90vw;
      /* Native browser resize handle — no JS needed. Growing the box extends
         left/up since the panel is anchored via bottom/right, which is the
         natural direction for a corner-docked panel. */
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

    #captcha-assistant-widget[hidden] {
      display: none;
    }

    .ca-header {
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

    .ca-title {
      font-size: 12px;
      font-weight: bold;
      color: #e0e4ea;
      white-space: nowrap;
    }

    .ca-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ca-close-btn {
      border: none;
      background: transparent;
      color: #9aa5b1;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      cursor: pointer;
    }

    .ca-close-btn:hover {
      color: #e74c3c;
    }

    .ca-timer {
      font-size: 12px;
      font-weight: bold;
      text-align: right;
      color: #8fa3bf;
    }

    .ca-timer.low {
      color: #e74c3c;
    }

    .ca-prompt {
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
    }

    .ca-prompt img {
      display: block;
      max-width: 100%;
      max-height: 22vh;
      width: auto;
      height: auto;
      margin: 0 auto 6px;
    }

    .ca-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ca-grid.done {
      opacity: 0.4;
    }

    .ca-thumb-row {
      position: relative;
    }

    .ca-thumb {
      display: block;
      /* Capped by height (viewport-relative) instead of stretched to the
         container's full width — candidate images vary a lot in native
         resolution between challenges, and forcing width:100% on all of
         them made low-res ones look blown-up/blurry and high-res ones look
         inconsistent in scale next to each other. This keeps every image at
         a consistent visual size regardless of its native resolution. */
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
    .ca-thumb.focused {
      border-color: #2ecc71;
    }

    .ca-controls-row {
      margin-bottom: 8px;
    }

    .ca-get-captcha-btn {
      border: 1px solid #333c48;
      background: #1c2027;
      color: #ddd;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    .ca-get-captcha-btn:not(:disabled):hover {
      background: #2f3542;
    }

    .ca-get-captcha-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .ca-hint {
      font-size: 11px;
      color: #8a94a3;
      margin-bottom: 8px;
    }

    .ca-status {
      margin-top: 8px;
      font-size: 12px;
      color: #9c9;
    }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function buildWidget() {
    const widget = document.createElement('div');
    widget.id = 'captcha-assistant-widget';
    widget.hidden = true;
    widget.innerHTML = `
      <div class="ca-header">
        <span class="ca-title">Captcha Assistant</span>
        <div class="ca-header-right">
          <div class="ca-timer"></div>
          <button type="button" class="ca-close-btn" title="Hide">&times;</button>
        </div>
      </div>
      <div class="ca-controls-row">
        <button type="button" class="ca-get-captcha-btn">Get Captcha</button>
      </div>
      <div class="ca-hint">Double-click an image, or use ↑/↓ (W/S) + Enter/Space, to answer.</div>
      <div class="ca-prompt"></div>
      <div class="ca-grid"></div>
      <div class="ca-status"></div>
    `;
    document.body.appendChild(widget);
    return {
      root: widget,
      header: widget.querySelector('.ca-header'),
      timer: widget.querySelector('.ca-timer'),
      closeBtn: widget.querySelector('.ca-close-btn'),
      getCaptchaBtn: widget.querySelector('.ca-get-captcha-btn'),
      prompt: widget.querySelector('.ca-prompt'),
      grid: widget.querySelector('.ca-grid'),
      status: widget.querySelector('.ca-status'),
    };
  }

  injectStyle();
  const el = buildWidget();

  // --- position persistence + dragging ---------------------------------

  const POSITION_STORAGE_KEY = 'captcha-assistant:position';

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
      // storage unavailable (private browsing, quota, etc.) — position just won't persist
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

  // Keeps the widget on-screen if the saved position no longer fits (e.g.
  // the browser window/monitor changed since it was last dragged).
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
      if (downEvent.target.closest('.ca-close-btn')) return;
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
  el.closeBtn.addEventListener('click', () => hideWidget());

  // --- Get Captcha button --------------------------------------------------
  //
  // Forwards to the real (hidden) reloadNode rather than calling
  // TCaptcha.onReloadClick() ourselves, so its disabled/cooldown state
  // (toggleReloadBtn()) is respected for free — clicking a disabled button
  // via .click() is a no-op, same as a real user clicking it directly. Same
  // pattern as 4chan-captcha-helper-4chanx-injector.user.js and
  // 4chan-fully-integrated-captcha-assistant.user.js's own Get Captcha
  // buttons — this widget was the one sibling missing it, since it used to
  // assume the user would find and click 4chan's own tiny reload icon
  // themselves.

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
  // code path actually changed reloadNode's state.
  setInterval(syncGetCaptchaButton, 400);

  el.getCaptchaBtn.addEventListener('click', () => {
    // Explicit guard, not just relying on the disabled attribute alone --
    // this button's disabled state is set from several different places
    // (mirrored from the real button, and explicitly during a pending
    // verification), so double-check here rather than trust any one of
    // them individually.
    if (el.getCaptchaBtn.disabled) return;
    const t = window.TCaptcha;
    if (t && t.reloadNode) {
      t.reloadNode.click();
    } else {
      showWidget();
      setStatus('Captcha not ready yet — open the reply/new-thread form first, then try again.');
    }
  });

  // --- state -------------------------------------------------------------

  const DEFAULT_CAPTCHA_TTL_SECONDS = 120;
  const LOW_TIME_THRESHOLD_SECONDS = 20;

  const state = {
    tasks: [],
    currentTaskId: 0,
    currentItemIndex: 0,
  };

  let expiryTimestamp = null;
  let timerIntervalId = null;

  function showWidget() {
    el.root.hidden = false;
    clampToViewport();
  }

  function hideWidget() {
    el.root.hidden = true;
    el.grid.innerHTML = '';
    el.prompt.innerHTML = '';
    el.status.textContent = '';
    stopTimer();
  }

  function setStatus(text) {
    el.status.textContent = text;
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

  // --- rendering -----------------------------------------------------------
  //
  // There's a single "current" candidate (state.currentItemIndex) — click or
  // arrow-key nav both just move it, with one shared highlight. Double-click
  // or Enter/Space sends whichever one is current; there's no separate
  // "selected, now hit Send" step or state.

  function focusItem(itemIndex) {
    state.currentItemIndex = itemIndex;
    applyFocusHighlight();
  }

  function selectAndSend(itemIndex) {
    focusItem(itemIndex);
    sendSelection();
  }

  function sendSelection() {
    if (!state.currentItemIndex) return;
    const t = window.TCaptcha;
    if (!t || !t.sliderNode) return;
    // Ignore stale sends aimed at a task that's no longer active.
    if (state.currentTaskId !== t.taskId) return;
    t.sliderNode.value = state.currentItemIndex;
    t.onSliderInput(); // updates the real widget's visible display to match
    t.onNextClick(); // appends the response digit, advances or finishes
    // No manual re-render here — onNextClick() internally calls the
    // already-wrapped setTaskId/setTaskNodeContent, so onTaskChanged/onDone
    // below will fire on their own and rebuild the DOM from scratch.
  }

  function renderCurrentTask() {
    const task = state.tasks[state.currentTaskId];
    el.grid.innerHTML = '';
    el.grid.classList.remove('done');
    el.prompt.innerHTML = '';

    if (!task) return;

    // task.str is HTML from 4chan's own captcha server (may embed a
    // reference image) — same trust boundary as the rest of the captcha
    // widget itself, which 4chan's own page already renders this way.
    if (task.str) {
      el.prompt.innerHTML = task.str;
    } else if (task.img) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${task.img}`;
      el.prompt.appendChild(img);
    }

    (task.items || []).forEach((item, index) => {
      const itemIndex = index + 1; // TCaptcha's own slider/response indexing is 1-based

      const row = document.createElement('div');
      row.className = 'ca-thumb-row';

      const img = document.createElement('img');
      img.className = 'ca-thumb';
      img.src = `data:image/png;base64,${item}`;
      if (itemIndex === state.currentItemIndex) {
        img.classList.add('focused');
      }
      img.addEventListener('click', () => focusItem(itemIndex));
      img.addEventListener('dblclick', () => selectAndSend(itemIndex));

      row.appendChild(img);
      el.grid.appendChild(row);
    });

    setStatus(`Task ${state.currentTaskId + 1} of ${state.tasks.length}`);
  }

  function applyFocusHighlight() {
    const thumbs = el.grid.querySelectorAll('.ca-thumb');
    thumbs.forEach((thumb, index) => {
      thumb.classList.toggle('focused', index + 1 === state.currentItemIndex);
    });
  }

  // --- keyboard navigation -------------------------------------------------
  //
  // Up/Down (or W/S) move the focus highlight across the current task's
  // thumbnails; Enter/Space selects and sends the focused one. Scoped to
  // only fire while the widget is open and the user isn't typing somewhere
  // else on the page (a normal <input>/<textarea>/contenteditable) — 4chan's
  // own reply form has no keyboard shortcuts of its own to collide with, but
  // arrows/space/enter are all normal input while composing a post.

  function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  function moveFocus(delta) {
    const task = state.tasks[state.currentTaskId];
    const itemCount = task && task.items ? task.items.length : 0;
    if (itemCount === 0) return;
    const next = Math.min(Math.max(state.currentItemIndex + delta, 1), itemCount);
    if (next === state.currentItemIndex) return;
    state.currentItemIndex = next;
    applyFocusHighlight();
  }

  document.addEventListener('keydown', (event) => {
    if (el.root.hidden) return;
    if (isTypingTarget(event.target)) return;
    if (!state.tasks.length) return;

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
        selectAndSend(state.currentItemIndex);
        break;
      default:
        break;
    }
  });

  // --- lifecycle handlers, called directly from the TCaptcha patch below ---

  function onLoading() {
    showWidget();
    state.tasks = [];
    state.currentTaskId = 0;
    state.currentItemIndex = 0;
    el.grid.innerHTML = '';
    el.prompt.innerHTML = '';
    setStatus('Loading captcha…');
    stopTimer();
  }

  function onChallengeReady(challenge, tasks, ttl) {
    showWidget();
    state.tasks = tasks || [];
    state.currentTaskId = 0;
    state.currentItemIndex = 0;
    renderCurrentTask();
    startTimer(ttl);
  }

  function onTaskChanged(taskId) {
    state.currentTaskId = taskId;
    state.currentItemIndex = 0;
    renderCurrentTask();
  }

  function onItemFocused(itemIndex) {
    state.currentItemIndex = itemIndex;
    applyFocusHighlight();
  }

  function onDone() {
    setStatus('All tasks complete — ready to submit.');
    el.grid.classList.add('done');
  }

  // Covers messages like "Please wait a while before making a thread or
  // verify your email..." and its "You can now request a captcha." follow-up
  // — TCaptcha sends these through the same content channel as task prompts,
  // just with no active challenge behind them (no candidate images to grid).
  function onStatusMessage(content) {
    if (!content) return;
    showWidget();
    el.grid.innerHTML = '';
    el.grid.classList.remove('done');
    el.prompt.innerHTML = content;
  }

  function onNoVerificationNeeded() {
    showWidget();
    el.grid.innerHTML = '';
    el.prompt.innerHTML = '';
    setStatus('Verification not required.');
    stopTimer();
  }

  function onExpired() {
    setStatus('Captcha expired — click Get Captcha again.');
    stopTimer();
    el.timer.textContent = 'Expired';
    el.timer.classList.add('low');
  }

  function onCleared() {
    hideWidget();
  }

  // --- interactive verification (e.g. Cloudflare) detection ---------------
  //
  // Sometimes the captcha iframe comes back with an interactive Cloudflare
  // challenge instead of a normal response. That page runs entirely inside
  // the iframe (cross-origin — sys.4chan.org vs boards.4chan.org — so we
  // can't read its content to detect this directly) and never calls
  // TCaptcha's own postMessage-driven methods until the user completes it,
  // which can take a while. This script never hides the real captcha widget
  // (unlike the other two), so there's nothing to reveal — just let the user
  // know to look at it. Heuristic: TCaptcha.load() starts a request; if none
  // of the normal "a response arrived" hooks fire within a few seconds,
  // assume verification is needed. Once a real response does arrive — per
  // testing, this shows up as a long setReloadCd() cooldown (the same
  // "please wait ~5 minutes" flow) — the message clears on its own.

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

  function markResponseArrived() {
    if (verificationCheckTimeoutId) {
      clearTimeout(verificationCheckTimeoutId);
      verificationCheckTimeoutId = null;
    }
    verificationPending = false;
    // Re-sync rather than just re-enabling -- a fresh reload cooldown may
    // have started at the same time the response arrived.
    syncGetCaptchaButton();
  }

  function onVerificationNeeded() {
    verificationPending = true;
    onStatusMessage('Additional verification required — please complete it in the captcha box, then wait a moment.');
    // Explicit, guaranteed disable for the whole verification window rather
    // than relying solely on the mirrored native state, which is what was
    // actually clicked to get here and could otherwise look re-enabled.
    el.getCaptchaBtn.disabled = true;
  }

  // --- TCaptcha patch --------------------------------------------------------
  //
  // window.TCaptcha is 4chan's own proprietary captcha widget global. Since
  // this script runs directly in the page's JS world (@grant none), it's
  // just accessible — no main-world injection trick needed.
  // setTaskNodeContent alone catches nearly every visible state change (each
  // task's base64 image, prompt text, "Done.", "Captcha expired.", error
  // text), so it's the single richest hook point.

  function patchTCaptchaOnceReady() {
    const t = window.TCaptcha;
    if (!t || t.__captchaAssistantPatched) return Boolean(t);
    t.__captchaAssistantPatched = true;

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

    wrap('onReloadClick', () => onLoading());

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
    wrap('clearChallenge', () => onCleared());

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
        syncGetCaptchaButton();
      }
    }, 500);
  } else {
    syncGetCaptchaButton();
  }
})();
