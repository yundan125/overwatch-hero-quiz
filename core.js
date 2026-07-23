(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NameGameCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SAVE_VERSION = 2;
  const EXPORT_VERSION = 1;
  const VALID_ROLES = ['tank', 'damage', 'support'];
  const VALID_FILTERS = ['all', ...VALID_ROLES];
  const VALID_MODES = ['icon', 'fullbody'];
  const VALID_PLAY_STYLES = ['single', 'list'];

  function gameError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function fisherYates(items, randomFn = Math.random) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomValue = Number(randomFn());
      const safeValue = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.9999999999999999) : 0;
      const target = Math.floor(safeValue * (index + 1));
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  }

  function validateHeroes(rawHeroes, reportError = () => {}) {
    if (!Array.isArray(rawHeroes)) throw gameError('INVALID_HERO_DATA', '英雄数据不是数组。');
    const seenIds = new Map();
    const seenChineseNames = new Map();
    const seenEnglishNames = new Map();
    const valid = [];

    rawHeroes.forEach((hero, index) => {
      const identity = hero && typeof hero === 'object' && hero.id ? hero.id : `索引 ${index}`;
      const errors = [];
      if (!hero || typeof hero !== 'object') {
        errors.push('字段 entry：条目不是对象');
      } else {
        if (typeof hero.id !== 'string' || !hero.id.trim()) errors.push('字段 id：缺少稳定 ID');
        if (typeof hero.nameZh !== 'string' || !hero.nameZh.trim()) errors.push('字段 nameZh：缺少中文名');
        if (typeof hero.nameEn !== 'string' || !hero.nameEn.trim()) errors.push('字段 nameEn：缺少英文名');
        if (!VALID_ROLES.includes(hero.role)) errors.push(`字段 role：非法职责 ${String(hero.role)}`);
        if (typeof hero.icon !== 'string' || !hero.icon.trim()) errors.push('字段 icon：缺少图标路径');
        if (typeof hero.fullbody !== 'string' || !hero.fullbody.trim()) errors.push('字段 fullbody：缺少全身照路径');
        for (const field of ['iconFallbacks', 'fullbodyFallbacks']) {
          if (hero[field] !== undefined && (!Array.isArray(hero[field]) || hero[field].some(path => typeof path !== 'string' || !path.trim()))) {
            errors.push(`字段 ${field}：备用路径必须是字符串数组`);
          }
        }
        if (hero.id && seenIds.has(hero.id)) errors.push(`字段 id：与 ${seenIds.get(hero.id)} 重复（${hero.id}）`);
        if (hero.nameZh && seenChineseNames.has(hero.nameZh)) errors.push(`字段 nameZh：与 ${seenChineseNames.get(hero.nameZh)} 重复（${hero.nameZh}）`);
        if (hero.nameEn && seenEnglishNames.has(hero.nameEn)) errors.push(`字段 nameEn：与 ${seenEnglishNames.get(hero.nameEn)} 重复（${hero.nameEn}）`);
      }

      if (errors.length) {
        errors.forEach(message => reportError(`[英雄数据 ${identity}] ${message}`, hero || null));
        return;
      }
      seenIds.set(hero.id, identity);
      seenChineseNames.set(hero.nameZh, identity);
      seenEnglishNames.set(hero.nameEn, identity);
      valid.push(hero);
    });

    if (valid.length !== rawHeroes.length) reportError(`英雄数据校验失败：${rawHeroes.length - valid.length} 条无效。`, null);
    if (new Set(valid.map(hero => hero.id)).size !== valid.length) reportError('英雄数量与可用名称池数量不一致。', null);
    return valid;
  }

  function filterHeroes(heroes, roleFilter) {
    if (!VALID_FILTERS.includes(roleFilter)) throw gameError('INVALID_ROLE_FILTER', `未知职责范围：${roleFilter}`);
    return roleFilter === 'all' ? heroes.slice() : heroes.filter(hero => hero.role === roleFilter);
  }

  function createDataSignature(heroes) {
    const source = heroes.map(hero => [
      hero.id, hero.nameZh, hero.nameEn, hero.role, hero.icon, hero.fullbody,
      ...(Array.isArray(hero.iconFallbacks) ? hero.iconFallbacks : []),
      ...(Array.isArray(hero.fullbodyFallbacks) ? hero.fullbodyFallbacks : [])
    ].join('|')).join('\n');
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `v${SAVE_VERSION}-${heroes.length}-${hash.toString(16).padStart(8, '0')}`;
  }

  function createGame(heroes, config, randomFn = Math.random, now = new Date().toISOString()) {
    const normalizedConfig = {
      mode: config && config.mode,
      roleFilter: config && config.roleFilter,
      playStyle: config && config.playStyle
    };
    if (!VALID_MODES.includes(normalizedConfig.mode)) throw gameError('INVALID_MODE', '图片模式无效。');
    if (!VALID_FILTERS.includes(normalizedConfig.roleFilter)) throw gameError('INVALID_ROLE_FILTER', '英雄范围无效。');
    if (!VALID_PLAY_STYLES.includes(normalizedConfig.playStyle)) throw gameError('INVALID_PLAY_STYLE', '游戏方式无效。');
    const pool = filterHeroes(heroes, normalizedConfig.roleFilter);
    if (!pool.length) throw gameError('EMPTY_POOL', '当前筛选范围没有可用英雄。');
    // 展示顺序和名称顺序独立洗牌；后续关系只保存稳定 ID。
    const heroOrder = fisherYates(pool.map(hero => hero.id), randomFn);
    const nameOrder = fisherYates(pool.map(hero => hero.id), randomFn);
    const answers = {};
    heroOrder.forEach(heroId => {
      answers[heroId] = {
        heroId,
        selectedHeroId: null,
        reason: '',
        completed: false,
        skipped: false,
        imageFailed: false,
        imagePath: null
      };
    });
    return {
      version: SAVE_VERSION,
      dataSignature: createDataSignature(heroes),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      config: normalizedConfig,
      heroOrder,
      nameOrder,
      answers,
      currentIndex: 0,
      usedNameIds: []
    };
  }

  function copyGame(game) {
    const answers = {};
    Object.keys(game.answers || {}).forEach(heroId => { answers[heroId] = { ...game.answers[heroId] }; });
    return {
      ...game,
      config: { ...game.config },
      heroOrder: game.heroOrder.slice(),
      nameOrder: game.nameOrder.slice(),
      answers,
      usedNameIds: Array.isArray(game.usedNameIds) ? game.usedNameIds.slice() : []
    };
  }

  function deriveUsedNameIds(game) {
    return game.heroOrder
      .map(heroId => game.answers[heroId] && game.answers[heroId].selectedHeroId)
      .filter((heroId, index, array) => heroId && array.indexOf(heroId) === index);
  }

  function updateAssignment(game, heroId, patch, now = new Date().toISOString()) {
    if (!game || game.status !== 'active') throw gameError('GAME_LOCKED', '本局已锁定，不能继续修改。');
    if (!game.heroOrder.includes(heroId) || !game.answers[heroId]) throw gameError('UNKNOWN_HERO_ID', `本局不存在英雄 ID：${heroId}`);
    const current = game.answers[heroId];
    const hasSelected = Object.prototype.hasOwnProperty.call(patch, 'selectedHeroId');
    const hasReason = Object.prototype.hasOwnProperty.call(patch, 'reason');
    const hasCompleted = Object.prototype.hasOwnProperty.call(patch, 'completed');
    const hasSkipped = Object.prototype.hasOwnProperty.call(patch, 'skipped');
    let selectedHeroId = hasSelected ? patch.selectedHeroId : current.selectedHeroId;
    let reason = hasReason ? String(patch.reason == null ? '' : patch.reason).slice(0, 200) : current.reason;
    let completed = hasCompleted ? Boolean(patch.completed) : current.completed;
    let skipped = hasSkipped ? Boolean(patch.skipped) : current.skipped;

    if (skipped) {
      selectedHeroId = null;
      reason = '';
      completed = true;
    } else if (selectedHeroId !== null) {
      if (typeof selectedHeroId !== 'string' || !game.nameOrder.includes(selectedHeroId)) {
        throw gameError('INVALID_SELECTED_ID', `名称 ID 不在本局名称池中：${String(selectedHeroId)}`);
      }
      // 检查其他英雄的当前草稿和已完成答案，防止任何阶段重复占名。
      const owner = game.heroOrder.find(otherId => otherId !== heroId && game.answers[otherId].selectedHeroId === selectedHeroId);
      if (owner) throw gameError('NAME_IN_USE', '这个名称已经分配给其他英雄。');
    }

    if (completed && !skipped) {
      if (!selectedHeroId) throw gameError('NAME_REQUIRED', '请先选择一个名称。');
      if (!reason.trim()) throw gameError('REASON_REQUIRED', '理由不能为空。');
    }

    const next = copyGame(game);
    next.answers[heroId] = {
      ...current,
      ...patch,
      heroId,
      selectedHeroId,
      reason,
      completed,
      skipped
    };
    next.usedNameIds = deriveUsedNameIds(next);
    next.updatedAt = now;
    return next;
  }

  function setCurrentIndex(game, currentIndex, now = new Date().toISOString()) {
    if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= game.heroOrder.length) {
      throw gameError('INVALID_INDEX', '当前英雄位置无效。');
    }
    const next = copyGame(game);
    next.currentIndex = currentIndex;
    next.updatedAt = now;
    return next;
  }

  function getProgress(game) {
    const entries = game.heroOrder.map(heroId => game.answers[heroId]);
    const completedCount = entries.filter(answer => answer.completed).length;
    const skippedCount = entries.filter(answer => answer.completed && answer.skipped).length;
    const answeredCount = entries.filter(answer => answer.completed && !answer.skipped).length;
    const usedCount = deriveUsedNameIds(game).length;
    return {
      total: entries.length,
      completedCount,
      answeredCount,
      skippedCount,
      usedCount,
      remainingNames: Math.max(0, game.nameOrder.length - usedCount),
      percent: entries.length ? Math.round((completedCount / entries.length) * 100) : 0
    };
  }

  function canSubmit(game) {
    return Boolean(game && game.heroOrder.length && game.heroOrder.every(heroId => game.answers[heroId] && game.answers[heroId].completed));
  }

  function sameSet(first, second) {
    return first.length === second.length && new Set(first).size === first.length && first.every(value => second.includes(value));
  }

  function reconcileGame(savedGame, heroes) {
    // 恢复前先核对版本、数据签名、职责范围和每一条 ID 关系。
    if (!savedGame || typeof savedGame !== 'object') throw gameError('INVALID_SAVE', '未完成进度格式无效。');
    if (savedGame.version !== SAVE_VERSION) throw gameError('INCOMPATIBLE_SAVE', `存档版本 ${String(savedGame.version)} 与当前版本不兼容。`);
    if (savedGame.dataSignature !== createDataSignature(heroes)) throw gameError('INCOMPATIBLE_SAVE', '英雄数据已变化，旧进度不能安全恢复。');
    if (savedGame.status !== 'active') throw gameError('INVALID_SAVE', '存档不是未完成状态。');
    if (!savedGame.config || !VALID_MODES.includes(savedGame.config.mode) || !VALID_FILTERS.includes(savedGame.config.roleFilter) || !VALID_PLAY_STYLES.includes(savedGame.config.playStyle)) {
      throw gameError('INVALID_SAVE', '存档设置无效。');
    }
    const expectedIds = filterHeroes(heroes, savedGame.config.roleFilter).map(hero => hero.id);
    if (!Array.isArray(savedGame.heroOrder) || !sameSet(savedGame.heroOrder, expectedIds)) throw gameError('INCOMPATIBLE_SAVE', '存档中的英雄范围与当前数据不一致。');
    if (!Array.isArray(savedGame.nameOrder) || !sameSet(savedGame.nameOrder, expectedIds)) throw gameError('INCOMPATIBLE_SAVE', '存档中的名称池与当前数据不一致。');
    if (!savedGame.answers || typeof savedGame.answers !== 'object') throw gameError('INVALID_SAVE', '存档缺少分配数据。');
    if (!Number.isInteger(savedGame.currentIndex) || savedGame.currentIndex < 0 || savedGame.currentIndex >= expectedIds.length) throw gameError('INVALID_SAVE', '存档当前进度位置无效。');

    let normalized = copyGame(savedGame);
    const used = new Set();
    for (const heroId of savedGame.heroOrder) {
      const answer = savedGame.answers[heroId];
      if (!answer || answer.heroId !== heroId) throw gameError('INVALID_SAVE', `存档缺少英雄 ${heroId} 的分配数据。`);
      if (typeof answer.reason !== 'string' || answer.reason.length > 200) throw gameError('INVALID_SAVE', `英雄 ${heroId} 的理由格式无效。`);
      if (answer.skipped) {
        if (!answer.completed || answer.selectedHeroId !== null) throw gameError('INVALID_SAVE', `英雄 ${heroId} 的跳过状态无效。`);
      } else if (answer.selectedHeroId !== null) {
        if (!savedGame.nameOrder.includes(answer.selectedHeroId)) throw gameError('INVALID_SAVE', `英雄 ${heroId} 使用了范围外名称。`);
        if (used.has(answer.selectedHeroId)) throw gameError('INVALID_SAVE', `名称 ${answer.selectedHeroId} 被重复分配。`);
        used.add(answer.selectedHeroId);
      }
      if (answer.completed && !answer.skipped && (!answer.selectedHeroId || !answer.reason.trim())) {
        throw gameError('INVALID_SAVE', `英雄 ${heroId} 的完成状态与内容不一致。`);
      }
      normalized.answers[heroId] = {
        heroId,
        selectedHeroId: answer.selectedHeroId,
        reason: answer.reason,
        completed: Boolean(answer.completed),
        skipped: Boolean(answer.skipped),
        imageFailed: Boolean(answer.imageFailed),
        imagePath: typeof answer.imagePath === 'string' ? answer.imagePath : null
      };
    }
    normalized.usedNameIds = deriveUsedNameIds(normalized);
    return normalized;
  }

  function calculateStats(game) {
    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    game.heroOrder.forEach(heroId => {
      const answer = game.answers[heroId];
      if (answer.skipped) skippedCount += 1;
      else if (answer.selectedHeroId === heroId) correctCount += 1;
      else wrongCount += 1;
    });
    const answeredCount = correctCount + wrongCount;
    const accuracy = answeredCount ? Number(((correctCount / answeredCount) * 100).toFixed(1)) : 0;
    return { totalHeroes: game.heroOrder.length, answeredCount, skippedCount, correctCount, wrongCount, accuracy };
  }

  function getImagePaths(hero, mode) {
    const primary = mode === 'icon' ? hero.icon : hero.fullbody;
    const fallbacks = mode === 'icon' ? hero.iconFallbacks : hero.fullbodyFallbacks;
    return [primary, ...(Array.isArray(fallbacks) ? fallbacks : [])].filter((path, index, paths) => path && paths.indexOf(path) === index);
  }

  function buildResult(game, heroes, completedAt = new Date().toISOString()) {
    if (!canSubmit(game)) throw gameError('INCOMPLETE_GAME', '所有英雄完成分配或因图片故障跳过后才能提交。');
    const heroMap = new Map(heroes.map(hero => [hero.id, hero]));
    const stats = calculateStats(game);
    const answers = game.heroOrder.map(heroId => {
      const hero = heroMap.get(heroId);
      const answer = game.answers[heroId];
      const selected = answer.selectedHeroId ? heroMap.get(answer.selectedHeroId) : null;
      const skipped = Boolean(answer.skipped);
      return {
        heroId,
        realChineseName: hero.nameZh,
        realEnglishName: hero.nameEn,
        selectedHeroId: skipped ? null : selected.id,
        selectedChineseName: skipped ? null : selected.nameZh,
        selectedEnglishName: skipped ? null : selected.nameEn,
        reason: skipped ? '' : answer.reason.trim(),
        role: hero.role,
        correct: skipped ? false : selected.id === heroId,
        skipped,
        imageMode: game.config.mode,
        imagePath: answer.imagePath || getImagePaths(hero, game.config.mode)[0]
      };
    });
    return {
      version: EXPORT_VERSION,
      createdAt: completedAt,
      completedAt,
      gameStartedAt: game.createdAt,
      title: '没玩过守望先锋的人看图猜名字',
      mode: game.config.mode,
      roleFilter: game.config.roleFilter,
      playStyle: game.config.playStyle,
      ...stats,
      answers
    };
  }

  function requireField(condition, message) {
    if (!condition) throw gameError('INVALID_IMPORT', message);
  }

  function validateImportedResult(payload, heroes) {
    requireField(payload && typeof payload === 'object' && !Array.isArray(payload), '导入内容必须是 JSON 对象。');
    requireField(payload.version === EXPORT_VERSION, `不支持的结果版本：${String(payload.version)}。`);
    requireField(typeof payload.createdAt === 'string' && !Number.isNaN(Date.parse(payload.createdAt)), '缺少有效的 createdAt 时间。');
    requireField(VALID_MODES.includes(payload.mode), '图片模式无效。');
    requireField(VALID_FILTERS.includes(payload.roleFilter), '英雄范围无效。');
    requireField(VALID_PLAY_STYLES.includes(payload.playStyle), '游戏方式无效。');
    requireField(Array.isArray(payload.answers), '缺少 answers 数组。');

    const pool = filterHeroes(heroes, payload.roleFilter);
    const poolIds = pool.map(hero => hero.id);
    const heroMap = new Map(heroes.map(hero => [hero.id, hero]));
    requireField(payload.answers.length === pool.length, `结果应包含 ${pool.length} 名英雄，实际为 ${payload.answers.length}。`);
    requireField(payload.totalHeroes === pool.length, 'totalHeroes 与当前英雄范围不一致。');
    const seenHeroes = new Set();
    const seenNames = new Set();

    const answers = payload.answers.map((answer, index) => {
      requireField(answer && typeof answer === 'object', `answers[${index}] 不是对象。`);
      requireField(typeof answer.heroId === 'string' && poolIds.includes(answer.heroId), `answers[${index}].heroId 无效。`);
      requireField(!seenHeroes.has(answer.heroId), `英雄 ID ${answer.heroId} 重复。`);
      seenHeroes.add(answer.heroId);
      const hero = heroMap.get(answer.heroId);
      requireField(answer.realChineseName === hero.nameZh, `${answer.heroId} 的真实中文名与当前 heroes.js 不一致。`);
      requireField(answer.realEnglishName === hero.nameEn, `${answer.heroId} 的真实英文名与当前 heroes.js 不一致。`);
      requireField(typeof answer.skipped === 'boolean', `${answer.heroId} 缺少 skipped 布尔值。`);
      requireField(typeof answer.correct === 'boolean', `${answer.heroId} 缺少 correct 布尔值。`);
      requireField(answer.imageMode === payload.mode, `${answer.heroId} 的 imageMode 与本局不一致。`);
      requireField(typeof answer.imagePath === 'string' && getImagePaths(hero, payload.mode).includes(answer.imagePath), `${answer.heroId} 的图片路径无效。`);

      if (answer.skipped) {
        requireField(answer.selectedHeroId === null, `${answer.heroId} 已跳过但仍包含名称 ID。`);
        requireField(answer.correct === false, `${answer.heroId} 已跳过但被标记为猜对。`);
        return {
          heroId: hero.id,
          realChineseName: hero.nameZh,
          realEnglishName: hero.nameEn,
          selectedHeroId: null,
          selectedChineseName: null,
          selectedEnglishName: null,
          reason: '',
          role: hero.role,
          correct: false,
          skipped: true,
          imageMode: payload.mode,
          imagePath: answer.imagePath
        };
      }

      requireField(typeof answer.selectedHeroId === 'string' && poolIds.includes(answer.selectedHeroId), `${answer.heroId} 的名称 ID 无效或超出职责范围。`);
      requireField(!seenNames.has(answer.selectedHeroId), `名称 ID ${answer.selectedHeroId} 被重复分配。`);
      seenNames.add(answer.selectedHeroId);
      const selected = heroMap.get(answer.selectedHeroId);
      requireField(answer.selectedChineseName === selected.nameZh, `${answer.heroId} 的猜测中文名与名称 ID 不一致。`);
      requireField(answer.selectedEnglishName === selected.nameEn, `${answer.heroId} 的猜测英文名与名称 ID 不一致。`);
      requireField(typeof answer.reason === 'string' && answer.reason.trim().length >= 1 && answer.reason.length <= 200, `${answer.heroId} 的理由缺失或超过 200 字。`);
      requireField(answer.correct === (answer.selectedHeroId === answer.heroId), `${answer.heroId} 的 correct 字段与分配关系不一致。`);
      return {
        heroId: hero.id,
        realChineseName: hero.nameZh,
        realEnglishName: hero.nameEn,
        selectedHeroId: selected.id,
        selectedChineseName: selected.nameZh,
        selectedEnglishName: selected.nameEn,
        reason: answer.reason.trim(),
        role: hero.role,
        correct: selected.id === hero.id,
        skipped: false,
        imageMode: payload.mode,
        imagePath: answer.imagePath
      };
    });

    requireField(sameSet([...seenHeroes], poolIds), '导入结果没有覆盖当前职责范围的全部英雄。');
    const correctCount = answers.filter(answer => answer.correct).length;
    const skippedCount = answers.filter(answer => answer.skipped).length;
    const wrongCount = answers.length - correctCount - skippedCount;
    const answeredCount = correctCount + wrongCount;
    const accuracy = answeredCount ? Number(((correctCount / answeredCount) * 100).toFixed(1)) : 0;
    requireField(payload.answeredCount === answeredCount, 'answeredCount 与答案内容不一致。');
    requireField(payload.skippedCount === skippedCount, 'skippedCount 与答案内容不一致。');
    requireField(payload.correctCount === correctCount, 'correctCount 与答案内容不一致。');
    requireField(Number(payload.accuracy) === accuracy, 'accuracy 与答案内容不一致。');
    if (payload.wrongCount !== undefined) requireField(payload.wrongCount === wrongCount, 'wrongCount 与答案内容不一致。');

    return {
      version: EXPORT_VERSION,
      createdAt: payload.createdAt,
      completedAt: typeof payload.completedAt === 'string' && !Number.isNaN(Date.parse(payload.completedAt)) ? payload.completedAt : payload.createdAt,
      gameStartedAt: typeof payload.gameStartedAt === 'string' ? payload.gameStartedAt : null,
      title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : '没玩过守望先锋的人看图猜名字',
      mode: payload.mode,
      roleFilter: payload.roleFilter,
      playStyle: payload.playStyle,
      totalHeroes: answers.length,
      answeredCount,
      skippedCount,
      correctCount,
      wrongCount,
      accuracy,
      answers
    };
  }

  function serializeResult(result) {
    return JSON.stringify(result, null, 2);
  }

  return {
    SAVE_VERSION,
    EXPORT_VERSION,
    VALID_ROLES,
    VALID_FILTERS,
    VALID_MODES,
    VALID_PLAY_STYLES,
    fisherYates,
    validateHeroes,
    filterHeroes,
    createDataSignature,
    createGame,
    deriveUsedNameIds,
    updateAssignment,
    setCurrentIndex,
    getProgress,
    canSubmit,
    reconcileGame,
    calculateStats,
    getImagePaths,
    buildResult,
    validateImportedResult,
    serializeResult
  };
});
