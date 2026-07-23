(() => {
  'use strict';

  const STORAGE_KEY = 'owHeroNameGame.v2';
  const ROLE_LABELS = { all: '全部英雄', tank: '重装', damage: '输出', support: '支援' };
  const MODE_LABELS = { icon: '英雄图标', fullbody: '英雄全身照' };
  const PLAY_STYLE_LABELS = { single: '逐个填写', list: '全部列表' };
  const core = window.NameGameCore;

  const elements = {
    app: document.getElementById('app'),
    setupScreen: document.getElementById('setupScreen'),
    gameScreen: document.getElementById('gameScreen'),
    resultScreen: document.getElementById('resultScreen'),
    setupForm: document.getElementById('setupForm'),
    resumePanel: document.getElementById('resumePanel'),
    resumeTitle: document.getElementById('resumeTitle'),
    resumeSummary: document.getElementById('resumeSummary'),
    continueButton: document.getElementById('continueButton'),
    discardButton: document.getElementById('discardButton'),
    saveWarning: document.getElementById('saveWarning'),
    gamePreview: document.getElementById('gamePreview'),
    assetWarning: document.getElementById('assetWarning'),
    brandHome: document.getElementById('brandHome'),
    gameBackSetupButton: document.getElementById('gameBackSetupButton'),
    progressPosition: document.getElementById('progressPosition'),
    completedMetric: document.getElementById('completedMetric'),
    remainingMetric: document.getElementById('remainingMetric'),
    modeMetric: document.getElementById('modeMetric'),
    roleMetric: document.getElementById('roleMetric'),
    progressTrack: document.querySelector('.progress-track'),
    progressBar: document.getElementById('progressBar'),
    singleMode: document.getElementById('singleMode'),
    listMode: document.getElementById('listMode'),
    singleImageStage: document.getElementById('singleImageStage'),
    singleHeroImage: document.getElementById('singleHeroImage'),
    singleImageStatus: document.getElementById('singleImageStatus'),
    singleImageFault: document.getElementById('singleImageFault'),
    skipHeroButton: document.getElementById('skipHeroButton'),
    nameSearch: document.getElementById('nameSearch'),
    namePool: document.getElementById('namePool'),
    poolStatus: document.getElementById('poolStatus'),
    selectedNameStatus: document.getElementById('selectedNameStatus'),
    emptySearch: document.getElementById('emptySearch'),
    reasonInput: document.getElementById('reasonInput'),
    reasonCount: document.getElementById('reasonCount'),
    confirmAssignmentButton: document.getElementById('confirmAssignmentButton'),
    previousButton: document.getElementById('previousButton'),
    overviewButton: document.getElementById('overviewButton'),
    incompleteOnly: document.getElementById('incompleteOnly'),
    listOverviewButton: document.getElementById('listOverviewButton'),
    listCards: document.getElementById('listCards'),
    listSubmitButton: document.getElementById('listSubmitButton'),
    overviewDialog: document.getElementById('overviewDialog'),
    overviewBody: document.getElementById('overviewBody'),
    overviewSubmitButton: document.getElementById('overviewSubmitButton'),
    submitDialog: document.getElementById('submitDialog'),
    cancelSubmitButton: document.getElementById('cancelSubmitButton'),
    confirmSubmitButton: document.getElementById('confirmSubmitButton'),
    confirmDialog: document.getElementById('confirmDialog'),
    confirmDialogMessage: document.getElementById('confirmDialogMessage'),
    genericCancelButton: document.getElementById('genericCancelButton'),
    genericConfirmButton: document.getElementById('genericConfirmButton'),
    resultTitle: document.getElementById('resultTitle'),
    resultMeta: document.getElementById('resultMeta'),
    totalResultMetric: document.getElementById('totalResultMetric'),
    correctResultMetric: document.getElementById('correctResultMetric'),
    wrongResultMetric: document.getElementById('wrongResultMetric'),
    skippedResultMetric: document.getElementById('skippedResultMetric'),
    accuracyResultMetric: document.getElementById('accuracyResultMetric'),
    resultSort: document.getElementById('resultSort'),
    resultList: document.getElementById('resultList'),
    emptyResultFilter: document.getElementById('emptyResultFilter'),
    playAgainButton: document.getElementById('playAgainButton'),
    backSetupButton: document.getElementById('backSetupButton'),
    switchModeButton: document.getElementById('switchModeButton'),
    copyResultButton: document.getElementById('copyResultButton'),
    printResultButton: document.getElementById('printResultButton'),
    exportResultButton: document.getElementById('exportResultButton'),
    importResultButton: document.getElementById('importResultButton'),
    importFileInput: document.getElementById('importFileInput'),
    shareModeButton: document.getElementById('shareModeButton'),
    liveRegion: document.getElementById('liveRegion')
  };

  const state = {
    game: null,
    result: null,
    resumeGame: null,
    incompatibleSave: false,
    storageAvailable: true,
    storageRoot: null,
    singleImageToken: 0,
    singleImageReady: false,
    committing: false,
    genericConfirmAction: null,
    dialogReturnFocus: new Map(),
    listCardElements: new Map(),
    resultFilter: 'all',
    resultSort: 'order'
  };

  function announce(message) {
    elements.liveRegion.textContent = '';
    window.setTimeout(() => { elements.liveRegion.textContent = message; }, 20);
  }

  function createDefaultStorage() {
    return {
      version: core.SAVE_VERSION,
      lastMode: 'icon',
      lastRoleFilter: 'all',
      lastPlayStyle: 'single',
      currentGame: null,
      recentResult: null
    };
  }

  function safeStorageRead() {
    const fallback = createDefaultStorage();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('根对象不是对象');
      return { ...fallback, ...parsed };
    } catch (error) {
      state.storageAvailable = false;
      elements.saveWarning.textContent = `本地存档无法读取：${error.message}。本次仍可继续游戏，但刷新后可能无法恢复。`;
      elements.saveWarning.classList.remove('hidden');
      return fallback;
    }
  }

  function safeStorageWrite() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.storageRoot));
      state.storageAvailable = true;
      return true;
    } catch (error) {
      state.storageAvailable = false;
      elements.saveWarning.textContent = '浏览器阻止了本地存储。本次游戏仍可继续，但刷新后无法恢复进度。';
      elements.saveWarning.classList.remove('hidden');
      return false;
    }
  }

  function persistGame() {
    if (!state.storageRoot) return;
    state.storageRoot.version = core.SAVE_VERSION;
    state.storageRoot.currentGame = state.game && state.game.status === 'active' ? state.game : null;
    if (state.game) {
      state.storageRoot.lastMode = state.game.config.mode;
      state.storageRoot.lastRoleFilter = state.game.config.roleFilter;
      state.storageRoot.lastPlayStyle = state.game.config.playStyle;
    }
    safeStorageWrite();
  }

  function persistResult(result) {
    state.storageRoot.currentGame = null;
    state.storageRoot.recentResult = result;
    state.storageRoot.lastMode = result.mode;
    state.storageRoot.lastRoleFilter = result.roleFilter;
    state.storageRoot.lastPlayStyle = result.playStyle;
    safeStorageWrite();
  }

  let heroes = [];
  try {
    heroes = core.validateHeroes(window.HEROES || [], (message, hero) => console.error(message, hero || ''));
  } catch (error) {
    console.error('英雄数据无法加载：', error);
  }
  const heroMap = new Map(heroes.map(hero => [hero.id, hero]));

  function checkedValue(name) {
    return elements.setupForm.elements[name].value;
  }

  function setChecked(name, value) {
    const inputs = Array.from(elements.setupForm.querySelectorAll(`input[name="${name}"]`));
    const target = inputs.find(input => input.value === String(value));
    if (target) target.checked = true;
  }

  function getSetupConfig() {
    return {
      mode: checkedValue('imageMode'),
      roleFilter: checkedValue('roleFilter'),
      playStyle: checkedValue('playStyle')
    };
  }

  function applyPreferences(config) {
    setChecked('imageMode', config.mode);
    setChecked('roleFilter', config.roleFilter);
    setChecked('playStyle', config.playStyle);
    updateGamePreview();
  }

  function updateGamePreview() {
    let count = 0;
    try { count = core.filterHeroes(heroes, checkedValue('roleFilter')).length; } catch (_) { count = 0; }
    elements.gamePreview.textContent = `本局将展示 ${count} 位英雄，并提供 ${count} 个可分配名称；英雄顺序和名称顺序会分别随机打乱。`;
    elements.setupForm.querySelector('button[type="submit"]').disabled = count === 0 || heroes.length !== (window.HEROES || []).length;
  }

  function setScreen(screenName) {
    elements.setupScreen.classList.toggle('hidden', screenName !== 'setup');
    elements.gameScreen.classList.toggle('hidden', screenName !== 'game');
    elements.resultScreen.classList.toggle('hidden', screenName !== 'result');
    if (screenName !== 'result') setShareMode(false);
    window.setTimeout(() => elements.app.focus({ preventScroll: true }), 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openDialog(dialog, preferredFocus) {
    if (!dialog || dialog.open) return;
    state.dialogReturnFocus.set(dialog.id, document.activeElement);
    dialog.showModal();
    window.setTimeout(() => {
      const focusTarget = preferredFocus || dialog.querySelector('button, input, textarea, select');
      if (focusTarget) focusTarget.focus();
    }, 0);
  }

  function closeDialog(dialog) {
    if (dialog && dialog.open) dialog.close();
  }

  function restoreDialogFocus(dialog) {
    const previous = state.dialogReturnFocus.get(dialog.id);
    state.dialogReturnFocus.delete(dialog.id);
    if (previous && document.contains(previous)) previous.focus();
  }

  function askForConfirmation(message, confirmLabel, action) {
    elements.confirmDialogMessage.textContent = message;
    elements.genericConfirmButton.textContent = confirmLabel || '确认';
    state.genericConfirmAction = action;
    openDialog(elements.confirmDialog, elements.genericCancelButton);
  }

  function renderResumePanel() {
    if (!state.resumeGame && !state.incompatibleSave) {
      elements.resumePanel.classList.add('hidden');
      return;
    }
    elements.resumePanel.classList.remove('hidden');
    if (state.resumeGame) {
      const progress = core.getProgress(state.resumeGame);
      elements.resumeTitle.textContent = '发现一局未完成的游戏';
      elements.resumeSummary.textContent = `${MODE_LABELS[state.resumeGame.config.mode]} · ${ROLE_LABELS[state.resumeGame.config.roleFilter]} · ${PLAY_STYLE_LABELS[state.resumeGame.config.playStyle]}，已完成 ${progress.completedCount} / ${progress.total}。`;
      elements.continueButton.disabled = false;
      elements.continueButton.classList.remove('hidden');
      elements.discardButton.textContent = '放弃并开始新游戏';
    } else {
      elements.resumeTitle.textContent = '发现不兼容的旧进度';
      elements.resumeSummary.textContent = '英雄数据或存档版本已经变化，无法安全恢复。请清除旧进度后开始新游戏。';
      elements.continueButton.disabled = true;
      elements.continueButton.classList.add('hidden');
      elements.discardButton.textContent = '清除不兼容进度';
    }
  }

  function inspectSavedData() {
    state.storageRoot = safeStorageRead();
    const mode = core.VALID_MODES.includes(state.storageRoot.lastMode) ? state.storageRoot.lastMode : 'icon';
    const roleFilter = core.VALID_FILTERS.includes(state.storageRoot.lastRoleFilter) ? state.storageRoot.lastRoleFilter : 'all';
    const playStyle = core.VALID_PLAY_STYLES.includes(state.storageRoot.lastPlayStyle) ? state.storageRoot.lastPlayStyle : 'single';
    applyPreferences({ mode, roleFilter, playStyle });
    if (state.storageRoot.currentGame) {
      try {
        state.resumeGame = core.reconcileGame(state.storageRoot.currentGame, heroes);
      } catch (error) {
        state.incompatibleSave = true;
        elements.saveWarning.textContent = `${error.message} 请清除旧进度后开始新游戏。`;
        elements.saveWarning.classList.remove('hidden');
      }
    }
    renderResumePanel();
  }

  function clearSavedProgress() {
    state.storageRoot.currentGame = null;
    state.resumeGame = null;
    state.incompatibleSave = false;
    safeStorageWrite();
    elements.saveWarning.classList.add('hidden');
    renderResumePanel();
  }

  function startNewGame(config) {
    try {
      state.game = core.createGame(heroes, config);
      state.resumeGame = null;
      state.incompatibleSave = false;
      state.storageRoot.currentGame = state.game;
      persistGame();
      renderResumePanel();
      setScreen('game');
      renderGame();
      announce(`新游戏已开始，共 ${state.game.heroOrder.length} 位英雄。`);
    } catch (error) {
      elements.assetWarning.textContent = error.message;
      elements.assetWarning.classList.remove('hidden');
    }
  }

  function resumeGame() {
    if (!state.resumeGame) return;
    state.game = core.reconcileGame(state.resumeGame, heroes);
    setScreen('game');
    renderGame();
    announce('已恢复未完成的游戏。');
  }

  function updateMetrics() {
    if (!state.game) return;
    const progress = core.getProgress(state.game);
    elements.progressPosition.textContent = state.game.config.playStyle === 'single'
      ? `第 ${state.game.currentIndex + 1} / ${progress.total} 位英雄`
      : `全部 ${progress.total} 位英雄`;
    elements.completedMetric.textContent = `${progress.completedCount} / ${progress.total}`;
    elements.remainingMetric.textContent = String(progress.remainingNames);
    elements.modeMetric.textContent = MODE_LABELS[state.game.config.mode];
    elements.roleMetric.textContent = ROLE_LABELS[state.game.config.roleFilter];
    elements.progressBar.style.width = `${progress.percent}%`;
    elements.progressTrack.setAttribute('aria-valuenow', String(progress.percent));
    elements.listSubmitButton.disabled = !core.canSubmit(state.game);
    elements.overviewSubmitButton.disabled = !core.canSubmit(state.game);
  }

  function loadImageWithFallback(img, hero, mode, handlers = {}) {
    // 只尝试 heroes.js 已有的本地路径，不在运行时请求网络资源。
    const paths = core.getImagePaths(hero, mode);
    let cursor = 0;
    let stopped = false;
    img.removeAttribute('title');
    img.alt = handlers.alt || '待命名英雄图片';
    img.onload = null;
    img.onerror = null;
    img.removeAttribute('src');

    const tryNext = () => {
      if (stopped) return;
      if (cursor >= paths.length) {
        img.onload = null;
        img.onerror = null;
        if (handlers.onFailure) handlers.onFailure();
        return;
      }
      const path = paths[cursor];
      cursor += 1;
      img.onload = () => {
        if (stopped) return;
        img.onload = null;
        img.onerror = null;
        if (handlers.onSuccess) handlers.onSuccess(path);
      };
      img.onerror = tryNext;
      img.src = path;
    };
    tryNext();
    return () => {
      stopped = true;
      img.onload = null;
      img.onerror = null;
    };
  }

  function currentHeroId() {
    return state.game.heroOrder[state.game.currentIndex];
  }

  function currentAnswer() {
    return state.game.answers[currentHeroId()];
  }

  function persistCurrentPatch(patch) {
    const heroId = currentHeroId();
    state.game = core.updateAssignment(state.game, heroId, patch);
    persistGame();
    return state.game.answers[heroId];
  }

  function renderGame() {
    if (!state.game) return;
    elements.singleMode.classList.toggle('hidden', state.game.config.playStyle !== 'single');
    elements.listMode.classList.toggle('hidden', state.game.config.playStyle !== 'list');
    updateMetrics();
    if (state.game.config.playStyle === 'single') renderSingleHero();
    else renderListCards();
  }

  function renderSingleHero() {
    const heroId = currentHeroId();
    const hero = heroMap.get(heroId);
    const answer = currentAnswer();
    const token = ++state.singleImageToken;
    state.singleImageReady = false;
    updateMetrics();

    elements.singleImageStage.classList.toggle('icon-mode', state.game.config.mode === 'icon');
    elements.singleImageStage.classList.toggle('fullbody-mode', state.game.config.mode === 'fullbody');
    elements.singleImageStage.setAttribute('aria-busy', 'true');
    elements.singleHeroImage.style.visibility = 'hidden';
    elements.singleImageStatus.textContent = '正在载入本地图片…';
    elements.singleImageStatus.classList.remove('hidden');
    elements.singleImageFault.classList.add('hidden');

    loadImageWithFallback(elements.singleHeroImage, hero, state.game.config.mode, {
      onSuccess(path) {
        if (token !== state.singleImageToken || currentHeroId() !== heroId) return;
        state.singleImageReady = true;
        elements.singleHeroImage.style.visibility = 'visible';
        elements.singleImageStatus.classList.add('hidden');
        elements.singleImageStage.setAttribute('aria-busy', 'false');
        try {
          state.game = core.updateAssignment(state.game, heroId, { imageFailed: false, imagePath: path });
          persistGame();
        } catch (_) { /* 页面切换时忽略过期图片回调 */ }
        updateSingleConfirmState();
      },
      onFailure() {
        if (token !== state.singleImageToken || currentHeroId() !== heroId) return;
        state.singleImageReady = false;
        elements.singleHeroImage.style.visibility = 'hidden';
        elements.singleImageStatus.textContent = '图片加载失败';
        elements.singleImageFault.classList.remove('hidden');
        elements.singleImageStage.setAttribute('aria-busy', 'false');
        try {
          state.game = core.updateAssignment(state.game, heroId, { imageFailed: true, imagePath: null, completed: answer.skipped });
          persistGame();
        } catch (_) { /* 保留当前可恢复状态 */ }
        updateMetrics();
        updateSingleConfirmState();
        announce('图片加载失败。可以跳过当前英雄。');
      }
    });

    elements.nameSearch.value = '';
    elements.reasonInput.value = answer.reason;
    elements.reasonCount.textContent = String(answer.reason.length);
    elements.previousButton.disabled = state.game.currentIndex === 0;
    elements.confirmAssignmentButton.textContent = state.game.currentIndex === state.game.heroOrder.length - 1
      ? '检查并提交全部结果'
      : '确认并进入下一位';
    renderNamePool();
    updateSingleConfirmState();
  }

  function availableNameIdsFor(heroId) {
    const usedByOthers = new Set(
      state.game.heroOrder
        .filter(otherId => otherId !== heroId)
        .map(otherId => state.game.answers[otherId].selectedHeroId)
        .filter(Boolean)
    );
    return state.game.nameOrder.filter(nameId => !usedByOthers.has(nameId));
  }

  function renderNamePool() {
    const heroId = currentHeroId();
    const answer = state.game.answers[heroId];
    const query = elements.nameSearch.value.trim().toLocaleLowerCase('zh-CN');
    const availableIds = availableNameIdsFor(heroId);
    const visibleIds = availableIds.filter(nameId => {
      const nameHero = heroMap.get(nameId);
      return !query || nameHero.nameZh.toLocaleLowerCase('zh-CN').includes(query) || nameHero.nameEn.toLocaleLowerCase('en').includes(query);
    });
    elements.namePool.replaceChildren();
    visibleIds.forEach(nameId => {
      const nameHero = heroMap.get(nameId);
      const selected = answer.selectedHeroId === nameId && !answer.skipped;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `name-button${selected ? ' is-selected' : ''}`;
      button.dataset.nameId = nameId;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${nameHero.nameZh}，英文名 ${nameHero.nameEn}${selected ? '，已选择' : ''}`);
      const chinese = document.createElement('strong');
      chinese.textContent = nameHero.nameZh;
      const english = document.createElement('small');
      english.textContent = nameHero.nameEn;
      button.append(chinese, english);
      button.addEventListener('click', () => selectName(nameId));
      elements.namePool.append(button);
    });
    elements.emptySearch.classList.toggle('hidden', visibleIds.length !== 0);
    elements.poolStatus.textContent = `可选 ${availableIds.length} 个 · 仅显示未被其他英雄使用的名称`;
    if (answer.skipped) {
      elements.selectedNameStatus.textContent = '因图片故障跳过；选择名称可取消跳过并继续填写。';
      elements.selectedNameStatus.classList.remove('has-selection');
    } else if (answer.selectedHeroId) {
      const selected = heroMap.get(answer.selectedHeroId);
      elements.selectedNameStatus.textContent = `✓ 已选择：${selected.nameZh}（${selected.nameEn}）`;
      elements.selectedNameStatus.classList.add('has-selection');
    } else {
      elements.selectedNameStatus.textContent = '尚未选择名称';
      elements.selectedNameStatus.classList.remove('has-selection');
    }
  }

  function selectName(nameId) {
    const answer = currentAnswer();
    try {
      persistCurrentPatch({
        selectedHeroId: nameId,
        skipped: false,
        completed: answer.selectedHeroId === nameId && !answer.skipped ? answer.completed : false
      });
      renderNamePool();
      updateMetrics();
      updateSingleConfirmState();
      announce(`已选择${heroMap.get(nameId).nameZh}。`);
    } catch (error) {
      announce(error.code === 'NAME_IN_USE' ? '名称已经被使用。' : error.message);
    }
  }

  function updateSingleConfirmState() {
    if (!state.game || state.game.config.playStyle !== 'single') return;
    const answer = currentAnswer();
    const validReason = answer.reason.trim().length >= 1;
    const canConfirm = !state.committing && !answer.skipped && state.singleImageReady && Boolean(answer.selectedHeroId) && validReason;
    elements.confirmAssignmentButton.disabled = !canConfirm;
  }

  function saveReasonDraft(value) {
    const answer = currentAnswer();
    const normalized = value.slice(0, 200);
    elements.reasonCount.textContent = String(normalized.length);
    try {
      persistCurrentPatch({ reason: normalized, completed: normalized === answer.reason ? answer.completed : false });
      updateMetrics();
      updateSingleConfirmState();
    } catch (error) {
      announce(error.message);
    }
  }

  function confirmCurrentAssignment() {
    if (state.committing || elements.confirmAssignmentButton.disabled) return;
    state.committing = true;
    elements.confirmAssignmentButton.disabled = true;
    const savedHeroId = currentHeroId();
    try {
      state.game = core.updateAssignment(state.game, savedHeroId, { completed: true });
      persistGame();
      announce('已保存当前英雄。');
      const isLast = state.game.currentIndex === state.game.heroOrder.length - 1;
      if (isLast) {
        if (core.canSubmit(state.game)) {
          updateMetrics();
          openSubmitConfirmation();
        } else {
          const nextIncomplete = state.game.heroOrder.findIndex(heroId => !state.game.answers[heroId].completed);
          state.game = core.setCurrentIndex(state.game, nextIncomplete);
          persistGame();
          renderSingleHero();
          announce('仍有未完成项目，已跳转到第一项未完成分配。');
        }
      } else {
        state.game = core.setCurrentIndex(state.game, state.game.currentIndex + 1);
        persistGame();
        renderSingleHero();
        announce('已进入下一位英雄。');
      }
    } catch (error) {
      if (error.code === 'REASON_REQUIRED') announce('理由不能为空。');
      else announce(error.message);
    } finally {
      state.committing = false;
      updateSingleConfirmState();
    }
  }

  function goToPreviousHero() {
    if (!state.game || state.game.currentIndex <= 0) return;
    state.game = core.setCurrentIndex(state.game, state.game.currentIndex - 1);
    persistGame();
    renderSingleHero();
    announce('已暂存当前内容并返回上一位英雄。');
  }

  function skipCurrentHero() {
    if (state.singleImageReady) return;
    try {
      state.game = core.updateAssignment(state.game, currentHeroId(), { skipped: true, completed: true, selectedHeroId: null, reason: '' });
      persistGame();
      updateMetrics();
      announce('已将当前英雄标记为因图片故障跳过。');
      if (state.game.currentIndex === state.game.heroOrder.length - 1) {
        if (core.canSubmit(state.game)) openSubmitConfirmation();
        else {
          const nextIncomplete = state.game.heroOrder.findIndex(heroId => !state.game.answers[heroId].completed);
          state.game = core.setCurrentIndex(state.game, nextIncomplete);
          persistGame();
          renderSingleHero();
        }
      } else {
        state.game = core.setCurrentIndex(state.game, state.game.currentIndex + 1);
        persistGame();
        renderSingleHero();
      }
    } catch (error) {
      announce(error.message);
    }
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function renderListCards() {
    state.listCardElements.clear();
    elements.listCards.replaceChildren();
    state.game.heroOrder.forEach((heroId, index) => {
      const hero = heroMap.get(heroId);
      const card = document.createElement('article');
      card.className = 'hero-edit-card';
      card.dataset.heroId = heroId;

      const number = document.createElement('p');
      number.className = 'card-number';
      const numberText = document.createElement('span');
      numberText.textContent = `第 ${index + 1} 位`;
      const status = document.createElement('span');
      status.className = 'card-state incomplete';
      number.append(numberText, status);

      const imageBox = document.createElement('div');
      imageBox.className = `card-image${state.game.config.mode === 'fullbody' ? ' fullbody' : ''}`;
      const img = document.createElement('img');
      img.alt = '待命名英雄图片';
      img.loading = 'lazy';
      img.draggable = false;
      const placeholder = document.createElement('div');
      placeholder.className = 'card-image-placeholder';
      placeholder.textContent = '正在载入本地图片…';
      imageBox.append(img, placeholder);

      const fields = document.createElement('div');
      fields.className = 'card-fields';
      const selectLabel = document.createElement('label');
      const selectCaption = document.createElement('span');
      selectCaption.textContent = '分配名称';
      const select = document.createElement('select');
      select.setAttribute('aria-label', `第 ${index + 1} 位英雄的分配名称`);
      selectLabel.append(selectCaption, select);

      const reasonLabel = document.createElement('label');
      const reasonCaption = document.createElement('span');
      reasonCaption.textContent = '为什么觉得他叫这个名字？';
      const textarea = document.createElement('textarea');
      textarea.maxLength = 200;
      textarea.rows = 4;
      textarea.placeholder = '写下你根据形象产生的联想。';
      textarea.setAttribute('aria-label', `第 ${index + 1} 位英雄的选择理由`);
      reasonLabel.append(reasonCaption, textarea);
      const count = document.createElement('p');
      count.className = 'card-count';

      const actions = document.createElement('div');
      actions.className = 'card-actions';
      const mainAction = document.createElement('button');
      mainAction.type = 'button';
      mainAction.className = 'primary-button compact card-main-action';
      const skipAction = document.createElement('button');
      skipAction.type = 'button';
      skipAction.className = 'ghost-button compact card-skip-action hidden';
      skipAction.textContent = '跳过';
      actions.append(mainAction, skipAction);
      fields.append(selectLabel, reasonLabel, count, actions);
      card.append(number, imageBox, fields);
      elements.listCards.append(card);

      const refs = { card, status, img, placeholder, select, textarea, count, mainAction, skipAction, imageReady: false, imageFailed: false };
      state.listCardElements.set(heroId, refs);
      select.addEventListener('change', () => updateListSelection(heroId, select.value || null));
      textarea.addEventListener('input', () => updateListReason(heroId, textarea.value));
      mainAction.addEventListener('click', () => handleListMainAction(heroId));
      skipAction.addEventListener('click', () => skipListHero(heroId));

      loadImageWithFallback(img, hero, state.game.config.mode, {
        onSuccess(path) {
          if (!card.isConnected || !state.game || state.game.status !== 'active') return;
          refs.imageReady = true;
          refs.imageFailed = false;
          placeholder.classList.add('hidden');
          try {
            state.game = core.updateAssignment(state.game, heroId, { imageFailed: false, imagePath: path });
            persistGame();
          } catch (_) { /* 页面切换时忽略过期图片回调 */ }
          syncListCard(heroId);
        },
        onFailure() {
          if (!card.isConnected || !state.game || state.game.status !== 'active') return;
          refs.imageReady = false;
          refs.imageFailed = true;
          placeholder.textContent = '图片加载失败';
          placeholder.classList.remove('hidden');
          const wasSkipped = state.game.answers[heroId].skipped;
          try {
            state.game = core.updateAssignment(state.game, heroId, { imageFailed: true, imagePath: null, completed: wasSkipped });
            persistGame();
          } catch (_) { /* 保留可恢复状态 */ }
          refreshAllListCards();
          announce(`第 ${index + 1} 位英雄图片加载失败，可以跳过。`);
        }
      });
    });
    refreshAllListCards();
  }

  function refreshListSelectOptions() {
    state.listCardElements.forEach((refs, heroId) => {
      const answer = state.game.answers[heroId];
      const availableIds = availableNameIdsFor(heroId);
      refs.select.replaceChildren(createOption('', '请选择名称'));
      availableIds.forEach(nameId => {
        const nameHero = heroMap.get(nameId);
        refs.select.append(createOption(nameId, `${nameHero.nameZh}（${nameHero.nameEn}）`));
      });
      refs.select.value = answer.selectedHeroId || '';
    });
  }

  function syncListCard(heroId) {
    const refs = state.listCardElements.get(heroId);
    if (!refs) return;
    const answer = state.game.answers[heroId];
    refs.card.classList.toggle('is-complete', answer.completed && !answer.skipped);
    refs.card.classList.toggle('is-skipped', answer.skipped);
    refs.status.className = `card-state ${answer.completed ? 'complete' : 'incomplete'}`;
    refs.status.textContent = answer.skipped ? '⚠ 因故障跳过' : answer.completed ? '✓ 已完成' : '○ 未完成';
    refs.select.value = answer.selectedHeroId || '';
    if (refs.textarea.value !== answer.reason) refs.textarea.value = answer.reason;
    refs.count.textContent = `${answer.reason.length} / 200 字`;
    refs.select.disabled = answer.completed;
    refs.textarea.disabled = answer.completed;
    refs.skipAction.classList.toggle('hidden', !refs.imageFailed || answer.skipped);
    if (answer.skipped) {
      refs.mainAction.textContent = '重新填写';
      refs.mainAction.disabled = false;
    } else if (answer.completed) {
      refs.mainAction.textContent = '编辑';
      refs.mainAction.disabled = false;
    } else {
      refs.mainAction.textContent = refs.imageFailed ? '请跳过故障图片' : refs.imageReady ? '保存本卡' : '等待图片加载';
      refs.mainAction.disabled = !refs.imageReady;
    }
    const hideComplete = elements.incompleteOnly.checked && answer.completed;
    refs.card.classList.toggle('hidden', hideComplete);
  }

  function refreshAllListCards() {
    refreshListSelectOptions();
    state.listCardElements.forEach((_, heroId) => syncListCard(heroId));
    updateMetrics();
  }

  function updateListSelection(heroId, selectedHeroId) {
    const answer = state.game.answers[heroId];
    try {
      state.game = core.updateAssignment(state.game, heroId, {
        selectedHeroId,
        skipped: false,
        completed: selectedHeroId === answer.selectedHeroId ? answer.completed : false
      });
      persistGame();
      refreshAllListCards();
      if (selectedHeroId) announce(`已选择${heroMap.get(selectedHeroId).nameZh}。`);
    } catch (error) {
      refreshAllListCards();
      announce(error.code === 'NAME_IN_USE' ? '名称已经被使用。' : error.message);
    }
  }

  function updateListReason(heroId, value) {
    const answer = state.game.answers[heroId];
    try {
      state.game = core.updateAssignment(state.game, heroId, {
        reason: value.slice(0, 200),
        completed: value === answer.reason ? answer.completed : false
      });
      persistGame();
      syncListCard(heroId);
      updateMetrics();
    } catch (error) {
      announce(error.message);
    }
  }

  function handleListMainAction(heroId) {
    const refs = state.listCardElements.get(heroId);
    const answer = state.game.answers[heroId];
    try {
      if (answer.skipped) {
        state.game = core.updateAssignment(state.game, heroId, { skipped: false, completed: false });
        persistGame();
        refreshAllListCards();
        refs.select.focus();
        return;
      }
      if (answer.completed) {
        state.game = core.updateAssignment(state.game, heroId, { completed: false });
        persistGame();
        refreshAllListCards();
        refs.select.focus();
        return;
      }
      if (!refs.imageReady) {
        announce('当前图片尚未加载成功；图片故障时请使用跳过按钮。');
        return;
      }
      state.game = core.updateAssignment(state.game, heroId, { completed: true });
      persistGame();
      refreshAllListCards();
      announce('已保存当前英雄。');
    } catch (error) {
      if (error.code === 'REASON_REQUIRED') announce('理由不能为空。');
      else announce(error.message);
    }
  }

  function skipListHero(heroId) {
    const refs = state.listCardElements.get(heroId);
    if (!refs || !refs.imageFailed) return;
    try {
      state.game = core.updateAssignment(state.game, heroId, { skipped: true, completed: true, selectedHeroId: null, reason: '' });
      persistGame();
      refreshAllListCards();
      announce('已将图片故障的英雄标记为跳过。');
    } catch (error) {
      announce(error.message);
    }
  }

  function renderOverview() {
    elements.overviewBody.replaceChildren();
    state.game.heroOrder.forEach((heroId, index) => {
      const hero = heroMap.get(heroId);
      const answer = state.game.answers[heroId];
      const row = document.createElement('tr');
      const imageCell = document.createElement('td');
      const imageBox = document.createElement('div');
      imageBox.className = `table-image${state.game.config.mode === 'fullbody' ? ' fullbody' : ''}`;
      const img = document.createElement('img');
      img.alt = '待命名英雄图片';
      img.loading = 'lazy';
      imageBox.append(img);
      imageCell.append(imageBox);
      loadImageWithFallback(img, hero, state.game.config.mode, {
        onFailure() {
          imageBox.textContent = '图片加载失败';
        }
      });

      const selectedCell = document.createElement('td');
      selectedCell.textContent = answer.skipped ? '未分配（图片故障）' : answer.selectedHeroId ? heroMap.get(answer.selectedHeroId).nameZh : '尚未选择';
      const reasonCell = document.createElement('td');
      reasonCell.className = 'table-reason';
      reasonCell.textContent = answer.skipped ? '—' : answer.reason || '尚未填写';
      const statusCell = document.createElement('td');
      statusCell.textContent = answer.skipped ? '⚠ 已跳过' : answer.completed ? '✓ 已完成' : '○ 未完成';
      const actionCell = document.createElement('td');
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'ghost-button compact';
      editButton.textContent = '修改';
      editButton.setAttribute('aria-label', `修改第 ${index + 1} 位英雄的分配`);
      editButton.addEventListener('click', () => editFromOverview(heroId));
      actionCell.append(editButton);
      row.append(imageCell, selectedCell, reasonCell, statusCell, actionCell);
      elements.overviewBody.append(row);
    });
    elements.overviewSubmitButton.disabled = !core.canSubmit(state.game);
  }

  function openOverview() {
    renderOverview();
    openDialog(elements.overviewDialog, elements.overviewDialog.querySelector('[data-close-dialog]'));
  }

  function editFromOverview(heroId) {
    closeDialog(elements.overviewDialog);
    if (state.game.config.playStyle === 'single') {
      state.game = core.setCurrentIndex(state.game, state.game.heroOrder.indexOf(heroId));
      persistGame();
      renderSingleHero();
    } else {
      const answer = state.game.answers[heroId];
      if (answer.completed) {
        state.game = core.updateAssignment(state.game, heroId, { completed: false, skipped: false });
        persistGame();
        refreshAllListCards();
      }
      window.setTimeout(() => {
        const refs = state.listCardElements.get(heroId);
        if (refs) {
          refs.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          refs.select.focus({ preventScroll: true });
        }
      }, 50);
    }
  }

  function openSubmitConfirmation() {
    if (!core.canSubmit(state.game)) {
      announce('所有英雄完成分配或因图片故障跳过后才能提交。');
      return;
    }
    let returnTarget = null;
    if (elements.overviewDialog.open) {
      returnTarget = state.dialogReturnFocus.get(elements.overviewDialog.id) || null;
      state.dialogReturnFocus.delete(elements.overviewDialog.id);
      closeDialog(elements.overviewDialog);
    }
    openDialog(elements.submitDialog, elements.cancelSubmitButton);
    if (returnTarget) state.dialogReturnFocus.set(elements.submitDialog.id, returnTarget);
  }

  function submitGame() {
    if (state.committing) return;
    state.committing = true;
    elements.confirmSubmitButton.disabled = true;
    try {
      const result = core.buildResult(state.game, heroes);
      state.game = { ...state.game, status: 'submitted' };
      state.result = result;
      persistResult(result);
      closeDialog(elements.submitDialog);
      renderResult();
      setScreen('result');
      announce('全部结果已提交，真实答案现在已显示。');
    } catch (error) {
      announce(error.message);
    } finally {
      state.committing = false;
      elements.confirmSubmitButton.disabled = false;
    }
  }

  function formatAccuracy(value) {
    return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
  }

  function renderResult() {
    if (!state.result) return;
    const result = state.result;
    elements.resultTitle.textContent = result.title || '没玩过守望先锋的人看图猜名字';
    const completed = new Date(result.completedAt || result.createdAt);
    elements.resultMeta.textContent = `${MODE_LABELS[result.mode]} · ${ROLE_LABELS[result.roleFilter]} · ${PLAY_STYLE_LABELS[result.playStyle]} · 完成时间 ${completed.toLocaleString('zh-CN')}`;
    elements.totalResultMetric.textContent = String(result.totalHeroes);
    elements.correctResultMetric.textContent = String(result.correctCount);
    elements.wrongResultMetric.textContent = String(result.wrongCount);
    elements.skippedResultMetric.textContent = String(result.skippedCount);
    elements.accuracyResultMetric.textContent = formatAccuracy(result.accuracy);
    elements.resultSort.value = state.resultSort;
    document.querySelectorAll('[data-result-filter]').forEach(button => {
      const active = button.dataset.resultFilter === state.resultFilter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderResultList();
  }

  function sortedFilteredResults() {
    let answers = state.result.answers.map((answer, index) => ({ ...answer, originalIndex: index }));
    if (state.resultFilter === 'correct') answers = answers.filter(answer => answer.correct);
    if (state.resultFilter === 'wrong') answers = answers.filter(answer => !answer.correct && !answer.skipped);
    const roleOrder = { tank: 0, damage: 1, support: 2 };
    if (state.resultSort === 'wrongFirst') {
      answers.sort((first, second) => {
        const rank = answer => answer.skipped ? 2 : answer.correct ? 1 : 0;
        return rank(first) - rank(second) || first.originalIndex - second.originalIndex;
      });
    } else if (state.resultSort === 'role') {
      answers.sort((first, second) => roleOrder[first.role] - roleOrder[second.role] || first.originalIndex - second.originalIndex);
    } else if (state.resultSort === 'name') {
      answers.sort((first, second) => first.realChineseName.localeCompare(second.realChineseName, 'zh-CN'));
    }
    return answers;
  }

  function renderResultList() {
    const answers = sortedFilteredResults();
    elements.resultList.replaceChildren();
    elements.emptyResultFilter.classList.toggle('hidden', answers.length !== 0);
    answers.forEach(answer => {
      const card = document.createElement('article');
      card.className = `result-card ${answer.skipped ? 'is-skipped' : answer.correct ? 'is-correct' : 'is-wrong'}`;
      const imageBox = document.createElement('div');
      imageBox.className = `result-image${state.result.mode === 'fullbody' ? ' fullbody' : ''}`;
      const img = document.createElement('img');
      img.alt = `${answer.realChineseName}的英雄图片`;
      img.loading = 'lazy';
      const hero = heroMap.get(answer.heroId);
      const paths = [answer.imagePath, ...core.getImagePaths(hero, state.result.mode)].filter((path, index, list) => path && list.indexOf(path) === index);
      let cursor = 0;
      const tryResultPath = () => {
        if (cursor >= paths.length) {
          imageBox.textContent = '图片加载失败';
          return;
        }
        img.src = paths[cursor];
        cursor += 1;
      };
      img.onerror = tryResultPath;
      tryResultPath();
      imageBox.append(img);

      const names = document.createElement('div');
      names.className = 'result-names';
      const guessLabel = document.createElement('p');
      guessLabel.className = 'guess-label';
      guessLabel.textContent = '玩家猜测';
      const guessName = document.createElement('h3');
      guessName.className = 'guess-name';
      guessName.textContent = answer.skipped ? '未分配名称' : answer.selectedChineseName;
      const guessEnglish = document.createElement('p');
      guessEnglish.className = 'guess-en';
      guessEnglish.textContent = answer.skipped ? '图片故障跳过' : answer.selectedEnglishName;
      const realChinese = document.createElement('p');
      realChinese.className = 'real-name';
      realChinese.textContent = `真实名称：${answer.realChineseName}`;
      const realEnglish = document.createElement('p');
      realEnglish.className = 'real-name';
      realEnglish.textContent = `英文名：${answer.realEnglishName}`;
      const role = document.createElement('p');
      role.className = 'real-name';
      role.textContent = `职责：${ROLE_LABELS[answer.role]}`;
      const status = document.createElement('p');
      status.className = `result-status ${answer.skipped ? 'skipped' : answer.correct ? 'correct' : 'wrong'}`;
      status.textContent = answer.skipped ? '⚠ 因图片故障跳过' : answer.correct ? '✓ 猜对' : '✕ 猜错';
      names.append(guessLabel, guessName, guessEnglish, realChinese, realEnglish, role, status);

      const reason = document.createElement('div');
      reason.className = 'result-reason';
      const reasonLabel = document.createElement('p');
      reasonLabel.className = 'reason-label';
      reasonLabel.textContent = '选择理由';
      const reasonText = document.createElement('p');
      reasonText.textContent = answer.skipped ? '图片未能加载，本项没有分配名称。' : answer.reason;
      reason.append(reasonLabel, reasonText);
      card.append(imageBox, names, reason);
      elements.resultList.append(card);
    });
  }

  function resultToText() {
    const result = state.result;
    const lines = [
      result.title,
      `英雄：${result.totalHeroes}｜猜对：${result.correctCount}｜猜错：${result.wrongCount}｜跳过：${result.skippedCount}｜正确率：${formatAccuracy(result.accuracy)}`,
      `图片：${MODE_LABELS[result.mode]}｜范围：${ROLE_LABELS[result.roleFilter]}｜方式：${PLAY_STYLE_LABELS[result.playStyle]}`,
      ''
    ];
    result.answers.forEach((answer, index) => {
      if (answer.skipped) {
        lines.push(`${index + 1}. 因图片故障跳过｜真实：${answer.realChineseName}（${answer.realEnglishName}）`);
      } else {
        lines.push(`${index + 1}. 玩家猜测：${answer.selectedChineseName}（${answer.selectedEnglishName}）｜真实：${answer.realChineseName}（${answer.realEnglishName}）｜${answer.correct ? '✓ 猜对' : '✕ 猜错'}`);
        lines.push(`   理由：${answer.reason}`);
      }
    });
    return lines.join('\n');
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    if (!success) throw new Error('浏览器拒绝复制');
  }

  async function copyResult() {
    const text = resultToText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy(text);
      announce('文字结果已复制。');
    } catch (_) {
      try {
        fallbackCopy(text);
        announce('文字结果已复制。');
      } catch (error) {
        announce(`复制失败：${error.message}`);
      }
    }
  }

  function exportResult() {
    const blob = new Blob([core.serializeResult(state.result)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `overwatch-name-result-${new Date(state.result.createdAt).toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    announce('结果 JSON 已导出。');
  }

  function importResultFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      announce('导入失败：JSON 文件不能超过 2 MB。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state.result = core.validateImportedResult(parsed, heroes);
        state.resultFilter = 'all';
        state.resultSort = 'order';
        persistResult(state.result);
        renderResult();
        setScreen('result');
        announce('结果 JSON 导入成功。');
      } catch (error) {
        announce(`导入失败：${error.message}`);
        window.alert(`导入失败：${error.message}`);
      } finally {
        elements.importFileInput.value = '';
      }
    };
    reader.onerror = () => {
      announce('导入失败：无法读取文件。');
      elements.importFileInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  function setShareMode(enabled) {
    document.body.classList.toggle('share-mode', enabled);
    elements.shareModeButton.setAttribute('aria-pressed', String(enabled));
    elements.shareModeButton.textContent = enabled ? '退出分享长图模式' : '进入分享长图模式';
  }

  function returnToSetup() {
    if (state.game && state.game.status === 'active') {
      state.resumeGame = state.game;
      persistGame();
    }
    if (state.result) applyPreferences({ mode: state.result.mode, roleFilter: state.result.roleFilter, playStyle: state.result.playStyle });
    renderResumePanel();
    setScreen('setup');
  }

  elements.setupForm.addEventListener('change', updateGamePreview);
  elements.setupForm.addEventListener('submit', event => {
    event.preventDefault();
    const config = getSetupConfig();
    if (state.resumeGame || state.incompatibleSave) {
      askForConfirmation('开始新游戏会清除当前未完成进度，确定继续吗？', '清除并开始', () => {
        clearSavedProgress();
        startNewGame(config);
      });
    } else startNewGame(config);
  });
  elements.continueButton.addEventListener('click', resumeGame);
  elements.discardButton.addEventListener('click', () => {
    askForConfirmation('放弃后无法恢复这局已经填写的名称和理由，确定清除吗？', '确认清除', clearSavedProgress);
  });
  elements.brandHome.addEventListener('click', event => { event.preventDefault(); returnToSetup(); });
  elements.gameBackSetupButton.addEventListener('click', returnToSetup);
  elements.nameSearch.addEventListener('input', renderNamePool);
  elements.reasonInput.addEventListener('input', () => saveReasonDraft(elements.reasonInput.value));
  elements.confirmAssignmentButton.addEventListener('click', confirmCurrentAssignment);
  elements.previousButton.addEventListener('click', goToPreviousHero);
  elements.skipHeroButton.addEventListener('click', skipCurrentHero);
  elements.overviewButton.addEventListener('click', openOverview);
  elements.listOverviewButton.addEventListener('click', openOverview);
  elements.incompleteOnly.addEventListener('change', () => state.listCardElements.forEach((_, heroId) => syncListCard(heroId)));
  elements.listSubmitButton.addEventListener('click', openSubmitConfirmation);
  elements.overviewSubmitButton.addEventListener('click', openSubmitConfirmation);
  elements.cancelSubmitButton.addEventListener('click', () => closeDialog(elements.submitDialog));
  elements.confirmSubmitButton.addEventListener('click', submitGame);
  elements.genericCancelButton.addEventListener('click', () => {
    state.genericConfirmAction = null;
    closeDialog(elements.confirmDialog);
  });
  elements.genericConfirmButton.addEventListener('click', () => {
    const action = state.genericConfirmAction;
    state.genericConfirmAction = null;
    closeDialog(elements.confirmDialog);
    if (action) action();
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => closeDialog(document.getElementById(button.dataset.closeDialog)));
  });
  [elements.overviewDialog, elements.submitDialog, elements.confirmDialog].forEach(dialog => {
    dialog.addEventListener('close', () => {
      if (dialog === elements.confirmDialog) state.genericConfirmAction = null;
      restoreDialogFocus(dialog);
    });
  });
  document.querySelectorAll('[data-result-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.resultFilter = button.dataset.resultFilter;
      renderResult();
    });
  });
  elements.resultSort.addEventListener('change', () => {
    state.resultSort = elements.resultSort.value;
    renderResultList();
  });
  elements.playAgainButton.addEventListener('click', () => startNewGame({ mode: state.result.mode, roleFilter: state.result.roleFilter, playStyle: state.result.playStyle }));
  elements.switchModeButton.addEventListener('click', () => startNewGame({ mode: state.result.mode === 'icon' ? 'fullbody' : 'icon', roleFilter: state.result.roleFilter, playStyle: state.result.playStyle }));
  elements.backSetupButton.addEventListener('click', () => {
    state.game = null;
    state.resumeGame = null;
    returnToSetup();
  });
  elements.copyResultButton.addEventListener('click', copyResult);
  elements.printResultButton.addEventListener('click', () => window.print());
  elements.exportResultButton.addEventListener('click', exportResult);
  elements.importResultButton.addEventListener('click', () => elements.importFileInput.click());
  elements.importFileInput.addEventListener('change', () => importResultFile(elements.importFileInput.files[0]));
  elements.shareModeButton.addEventListener('click', () => {
    const enabled = !document.body.classList.contains('share-mode');
    setShareMode(enabled);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const isTextArea = target instanceof HTMLTextAreaElement;
    const isButton = target instanceof HTMLButtonElement;
    const isSelect = target instanceof HTMLSelectElement;
    if (event.key === '/' && !isTextArea && !(target instanceof HTMLInputElement) && !isButton && !isSelect && state.game && state.game.config.playStyle === 'single' && !elements.gameScreen.classList.contains('hidden')) {
      event.preventDefault();
      elements.nameSearch.focus();
      return;
    }
    if (event.key === 'Enter' && state.game && state.game.config.playStyle === 'single' && !elements.gameScreen.classList.contains('hidden') && !isTextArea && !isButton && !isSelect && !elements.confirmAssignmentButton.disabled) {
      event.preventDefault();
      confirmCurrentAssignment();
    }
  });

  if (!core || heroes.length === 0) {
    elements.assetWarning.textContent = '英雄数据加载失败，无法开始游戏。请检查 heroes.js 是否完整。';
    elements.assetWarning.classList.remove('hidden');
  } else if (heroes.length !== (window.HEROES || []).length) {
    elements.assetWarning.textContent = '部分英雄数据未通过校验。请查看控制台中包含英雄 ID 和字段名的错误。';
    elements.assetWarning.classList.remove('hidden');
  } else if (window.ASSETS_READY === false) {
    elements.assetWarning.textContent = '现有资源报告包含重复备用图警告；游戏仍会使用 heroes.js 中的本地主图和可用备用图，不会联网下载。';
    elements.assetWarning.classList.remove('hidden');
  }

  inspectSavedData();
  updateGamePreview();

  // 测试参数存在时才暴露最小接口；正常页面不会通过脚本接口关联图片与真实名称。
  if (new URLSearchParams(window.location.search).has('test')) {
    window.__OW_NAME_GAME_TEST__ = {
      heroes,
      core,
      state,
      startNewGame,
      renderGame,
      renderResult,
      openOverview,
      submitGame,
      getGame: () => state.game,
      setGame: game => { state.game = game; persistGame(); renderGame(); }
    };
  }
})();
