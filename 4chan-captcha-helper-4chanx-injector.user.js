// ==UserScript==
// @name         Captcha Helper 4chanx Injector
// @namespace    4chan-userscripts
// @version      1.1.0
// @description  Injects the captcha helper's preloaded-image grid directly into 4chan X's own Quick Reply widget, so 4chan X users get it without changing their normal posting UX.
// @match        https://boards.4chan.org/*
// @match        https://boards.4channel.org/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-helper-4chanx-injector.user.js
// @downloadURL  https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-helper-4chanx-injector.user.js
// ==/UserScript==

// Third sibling of 4chan-captcha-assistant.user.js (standalone floating
// widget) and 4chan-fully-integrated-captcha-assistant.user.js (replaces the
// whole post form). This one assumes the user already has real 4chan X
// installed and wants to keep using it — it does NOT hide, replace, or drive
// anything 4chan X owns. It only watches for 4chan X's own QR captcha area
// (`.captcha-root`, built by Captcha.t/Captcha.v2 when the user opens Reply)
// and injects our grid as a SIBLING right after it — never as a child inside
// `.captcha-container`, since Captcha.v2 runs its own MutationObserver on
// that container's children and foreign nodes inside it risk confusing that.
//
// window.TCaptcha is a singleton 4chan X itself calls .init() on — we never
// call init() ourselves here, we just wait for it and patch its methods,
// identical to the other two scripts' approach (own guard flag, so all three
// can be installed together without double-patching conflicts).
//
// 4chan X's own captcha UI is hidden by default (via a class added to
// .captcha-root, not .captcha-container — same className-clobbering gotcha
// documented below) so the injected widget reads as the primary captcha UI;
// a checkbox lets the user unhide the original if they want it back.

(function () {
  'use strict';

  // --- styles ----------------------------------------------------------------

  const STYLE = `
    .chi-widget {
      margin-top: 6px;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      padding: 6px;
      font-family: sans-serif;
      color: #ddd;
      background: #262b33;
      border: 1px solid #333c48;
      border-radius: 6px;
    }

    .chi-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #333c48;
    }

    .chi-title {
      font-size: 11px;
      font-weight: bold;
      color: #e0e4ea;
      white-space: nowrap;
    }

    .chi-timer {
      font-size: 11px;
      font-weight: bold;
      color: #8fa3bf;
    }

    .chi-timer.low {
      color: #e74c3c;
    }

    /* 4chan X's own .captcha-root (the OUTER wrapper it builds — not
       .captcha-container, which is the element TCaptcha.init() is handed
       and which init() clears the className of, same gotcha as the
       fully-integrated script). Adding a class here (not overwriting
       className) survives that untouched since TCaptcha never touches its
       container's parent. */
    .captcha-root.chi-hide-native {
      display: none !important;
    }

    .chi-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 11px;
      color: #9aa5b1;
    }

    .chi-controls-row label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      white-space: nowrap;
    }

    .chi-controls-row input[type='checkbox'] {
      margin: 0;
    }

    .chi-get-captcha-btn {
      border: 1px solid #333c48;
      background: #1c2027;
      color: #ddd;
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    /* :hover matches purely on pointer position, independent of :disabled —
       scoping it to :not(:disabled) so a disabled button doesn't visually
       highlight, and it comes back automatically (no JS needed) once
       re-enabled since it's a live selector, not a JS-applied class. */
    .chi-get-captcha-btn:not(:disabled):hover {
      background: #2f3542;
    }

    .chi-get-captcha-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .chi-prompt {
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 6px;
    }

    .chi-prompt img {
      display: block;
      max-width: 100%;
      max-height: 22vh;
      width: auto;
      height: auto;
      margin: 0 auto 6px;
    }

    .chi-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .chi-grid.done {
      opacity: 0.4;
    }

    .chi-thumb-row {
      position: relative;
    }

    .chi-thumb {
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
    .chi-thumb.focused {
      border-color: #2ecc71;
    }

    .chi-hint {
      font-size: 11px;
      color: #8a94a3;
      margin-bottom: 6px;
    }

    .chi-status {
      margin-top: 6px;
      font-size: 11px;
      color: #9c9;
    }
  `;

  function injectStyle() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  injectStyle();

  // --- widget DOM, one instance, re-anchored to whichever .captcha-root ----
  // --- is currently in the DOM (4chan X tears its QR dialog down/rebuilds --
  // --- it across sessions/thread switches) ----------------------------------

  function buildWidget() {
    const widget = document.createElement('div');
    widget.className = 'chi-widget';
    // Not hidden: the header/checkbox/Get Captcha button live in this same
    // container and need to be clickable before any challenge has loaded —
    // hiding the whole widget until then made Get Captcha unreachable. Only
    // the dynamic prompt/grid/status/timer content gets cleared when idle.
    widget.innerHTML = `
      <div class="chi-header">
        <span class="chi-title">Captcha Helper (by SSam)</span>
        <div class="chi-timer"></div>
      </div>
      <div class="chi-controls-row">
        <button type="button" class="chi-get-captcha-btn">Get Captcha</button>
        <label><input type="checkbox" class="chi-show-native-checkbox" /> Show original captcha UI</label>
      </div>
      <div class="chi-hint">Double-click an image, or use ↑/↓ (W/S) + Enter/Space, to answer.</div>
      <div class="chi-prompt"></div>
      <div class="chi-grid"></div>
      <div class="chi-status"></div>
    `;
    return {
      root: widget,
      timer: widget.querySelector('.chi-timer'),
      showNativeCheckbox: widget.querySelector('.chi-show-native-checkbox'),
      getCaptchaBtn: widget.querySelector('.chi-get-captcha-btn'),
      prompt: widget.querySelector('.chi-prompt'),
      grid: widget.querySelector('.chi-grid'),
      status: widget.querySelector('.chi-status'),
    };
  }

  const el = buildWidget();

  // Hidden by default — the checkbox flips this and re-applies it to
  // whichever .captcha-root is currently in the DOM.
  let hideNative = true;

  function applyNativeVisibility(root) {
    if (!root) return;
    root.classList.toggle('chi-hide-native', hideNative);
  }

  function tryAnchorWidget() {
    const root = document.querySelector('.captcha-root');
    if (!root) return;
    applyNativeVisibility(root);
    if (el.root.previousElementSibling === root && el.root.parentElement === root.parentElement) return; // already anchored here
    root.insertAdjacentElement('afterend', el.root);
  }

  // 4chan X's QR dialog (and its .captcha-root) doesn't exist until the user
  // opens Reply, and gets rebuilt across sessions/thread switches — keep
  // watching for the rest of the page's life rather than disconnecting after
  // the first find.
  new MutationObserver(() => tryAnchorWidget()).observe(document.body, { childList: true, subtree: true });
  tryAnchorWidget();

  el.showNativeCheckbox.addEventListener('change', () => {
    hideNative = !el.showNativeCheckbox.checked;
    applyNativeVisibility(document.querySelector('.captcha-root'));
  });

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
  // above: keeps re-syncing on a plain interval regardless of which native
  // code path actually changed reloadNode's state, in case some update to
  // TCaptcha's own script ever reassigns one of those methods after we've
  // already wrapped it (wrapping only ever patches whatever's assigned at
  // the moment we look).
  setInterval(syncGetCaptchaButton, 400);

  // Forwards to 4chan X's real "Get Captcha" button rather than calling
  // TCaptcha.onReloadClick() ourselves, so its disabled/cooldown state
  // (toggleReloadBtn()) is respected for free — clicking a disabled button
  // via .click() is a no-op, same as a real user clicking it directly.
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
      setStatus('Captcha not ready yet — try again in a moment.');
    }
  });

  // --- state (same shape/logic as the other two scripts) ------------------

  const DEFAULT_CAPTCHA_TTL_SECONDS = 120;
  const LOW_TIME_THRESHOLD_SECONDS = 20;

  const state = {
    tasks: [],
    currentTaskId: 0,
    currentItemIndex: 0,
  };

  let expiryTimestamp = null;
  let timerIntervalId = null;

  function clearCaptchaContent() {
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
    if (state.currentTaskId !== t.taskId) return;
    t.sliderNode.value = state.currentItemIndex;
    t.onSliderInput();
    t.onNextClick();
  }

  function renderCurrentTask() {
    const task = state.tasks[state.currentTaskId];
    el.grid.innerHTML = '';
    el.grid.classList.remove('done');
    el.prompt.innerHTML = '';

    if (!task) return;

    if (task.str) {
      el.prompt.innerHTML = task.str;
    } else if (task.img) {
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${task.img}`;
      el.prompt.appendChild(img);
    }

    (task.items || []).forEach((item, index) => {
      const itemIndex = index + 1;

      const row = document.createElement('div');
      row.className = 'chi-thumb-row';

      const img = document.createElement('img');
      img.className = 'chi-thumb';
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
    const thumbs = el.grid.querySelectorAll('.chi-thumb');
    thumbs.forEach((thumb, index) => {
      thumb.classList.toggle('focused', index + 1 === state.currentItemIndex);
    });
  }

  // --- keyboard navigation -------------------------------------------------
  //
  // Up/Down (or W/S) move the focus highlight across the current task's
  // thumbnails; Enter/Space selects and sends the focused one. Scoped to
  // only fire while this widget is actually anchored inside 4chan X's live
  // QR dialog (el.root.isConnected — it's a standing detached node the rest
  // of the time, per tryAnchorWidget() above) and the user isn't typing
  // somewhere else, so it never steals keystrokes from 4chan X's own comment
  // box or any of its other shortcuts.

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
    if (!el.root.isConnected) return;
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
    state.tasks = [];
    state.currentTaskId = 0;
    state.currentItemIndex = 0;
    el.grid.innerHTML = '';
    el.prompt.innerHTML = '';
    setStatus('Loading captcha…');
    stopTimer();
  }

  function onChallengeReady(challenge, tasks, ttl) {
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
    el.grid.innerHTML = '';
    el.grid.classList.remove('done');
    el.prompt.innerHTML = content;
  }

  function onNoVerificationNeeded() {
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
    clearCaptchaContent();
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
  // the real captcha UI (this script hides it by default) so they can. Once
  // a real response does arrive — per testing, this shows up as a long
  // setReloadCd() cooldown (the same "please wait ~5 minutes" flow) — put
  // the native UI back the way it was.

  const VERIFICATION_CHECK_DELAY_MS = 6000;

  let verificationCheckTimeoutId = null;
  let verificationPending = false;
  let hideNativeBeforeVerification = null;

  function armVerificationCheck() {
    if (verificationCheckTimeoutId) clearTimeout(verificationCheckTimeoutId);
    verificationCheckTimeoutId = setTimeout(() => {
      verificationCheckTimeoutId = null;
      onVerificationNeeded();
    }, VERIFICATION_CHECK_DELAY_MS);
  }

  // Called from every hook that means "a real response arrived" — cancels
  // the stuck-check timer, and if we'd already revealed the native UI for
  // this, restores it to whatever the user had it set to beforehand.
  function markResponseArrived() {
    if (verificationCheckTimeoutId) {
      clearTimeout(verificationCheckTimeoutId);
      verificationCheckTimeoutId = null;
    }
    if (verificationPending) {
      verificationPending = false;
      if (hideNativeBeforeVerification !== null) {
        hideNative = hideNativeBeforeVerification;
        el.showNativeCheckbox.checked = !hideNative;
        hideNativeBeforeVerification = null;
      }
      applyNativeVisibility(document.querySelector('.captcha-root'));
      // Re-sync rather than just re-enabling — a fresh reload cooldown may
      // have started at the same time the response arrived.
      syncGetCaptchaButton();
    }
  }

  function onVerificationNeeded() {
    verificationPending = true;
    hideNativeBeforeVerification = hideNative;
    hideNative = false;
    el.showNativeCheckbox.checked = true;
    applyNativeVisibility(document.querySelector('.captcha-root'));
    setStatus('Additional verification required — please complete it above, then wait a moment.');
    // Explicit, guaranteed disable for the whole verification window rather
    // than relying solely on the mirrored native state, which is what was
    // actually clicked to get here and could otherwise look re-enabled.
    el.getCaptchaBtn.disabled = true;
  }

  // --- TCaptcha patch (own guard flag, so this can be installed alongside --
  // --- either other script without double-patching conflicts) --------------

  function patchTCaptchaOnceReady() {
    const t = window.TCaptcha;
    if (!t || t.__injectorPatched) return Boolean(t);
    t.__injectorPatched = true;

    function wrap(name, handler) {
      const original = t[name];
      if (typeof original !== 'function') return;
      t[name] = function (...args) {
        const result = original.apply(this, args);
        try {
          handler(args, result);
        } catch (err) {
          // never let our own instrumentation break 4chan X's own captcha flow
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
        syncGetCaptchaButton();
      }
    }, 500);
  } else {
    syncGetCaptchaButton();
  }
})();
