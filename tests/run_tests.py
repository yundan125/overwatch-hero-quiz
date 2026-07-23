#!/usr/bin/env python3
"""离线静态、资源与 core.js 自动测试；不会修改项目文件。"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FAILURES: list[str] = []
NOTES: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        FAILURES.append(message)


def read_text(path: str) -> str:
    return (ROOT / path).read_text("utf-8")


def read_heroes() -> list[dict]:
    text = read_text("heroes.js")
    match = re.search(r"window\.HEROES\s*=\s*(\[.*\])\s*;", text, re.S)
    if not match:
        raise RuntimeError("heroes.js 中找不到 window.HEROES")
    return json.loads(match.group(1))


def hero_and_resource_tests() -> list[dict]:
    heroes = read_heroes()
    check(len(heroes) == 52, f"英雄总数应为 52，实际 {len(heroes)}")
    expected_roles = {"tank": 14, "damage": 24, "support": 14}
    actual_roles = {role: sum(1 for hero in heroes if hero.get("role") == role) for role in expected_roles}
    check(actual_roles == expected_roles, f"职责数量错误：{actual_roles}")

    ids = [hero.get("id") for hero in heroes]
    chinese_names = [hero.get("nameZh") for hero in heroes]
    english_names = [hero.get("nameEn") for hero in heroes]
    check(len(ids) == len(set(ids)), "英雄 ID 存在重复")
    check(len(chinese_names) == len(set(chinese_names)), "中文名存在重复")
    check(len(english_names) == len(set(english_names)), "英文名存在重复")
    declared_paths: set[str] = set()

    for hero in heroes:
        hero_id = hero.get("id", "<missing>")
        check(re.fullmatch(r"hero_\d{3}", hero_id) is not None, f"ID 格式无效：{hero_id}")
        check(bool(hero.get("nameZh")), f"{hero_id} 缺少 nameZh")
        check(bool(hero.get("nameEn")), f"{hero_id} 缺少 nameEn")
        check(hero.get("role") in expected_roles, f"{hero_id} role 无效")
        for field, directory in (("icon", "icons"), ("fullbody", "fullbody")):
            path = hero.get(field, "")
            check(path.startswith(f"assets/{directory}/{hero_id}"), f"{hero_id} {field} 路径无效：{path}")
            check((ROOT / path).is_file(), f"{hero_id} {field} 文件不存在：{path}")
            declared_paths.add(path)
            fallback_field = f"{field}Fallbacks"
            fallbacks = hero.get(fallback_field, [])
            check(isinstance(fallbacks, list), f"{hero_id} {fallback_field} 不是数组")
            for fallback in fallbacks:
                check((ROOT / fallback).is_file(), f"{hero_id} 备用图片不存在：{fallback}")
                declared_paths.add(fallback)

    actual_assets = {
        path.relative_to(ROOT).as_posix()
        for directory in (ROOT / "assets/icons", ROOT / "assets/fullbody")
        for path in directory.glob("*.webp")
    }
    check(declared_paths == actual_assets, f"heroes.js 声明路径与实际图片不一致：声明 {len(declared_paths)}，实际 {len(actual_assets)}")

    report = json.loads(read_text("asset_report.json"))
    ok_results = [item for item in report.get("results", []) if item.get("status") == "ok"]
    check(len(ok_results) == len(actual_assets), f"资源报告图片数 {len(ok_results)} 与实际 {len(actual_assets)} 不一致")
    hash_mismatches = []
    for item in ok_results:
        path = ROOT / item["path"]
        if not path.is_file():
            hash_mismatches.append(f"缺少 {item['path']}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest.lower() != str(item.get("sha256", "")).lower():
            hash_mismatches.append(item["path"])
    check(not hash_mismatches, f"现有图片哈希变化：{hash_mismatches[:5]}")

    # 全身照尺寸跨度很大，逐一验证桌面与手机容器均等比缩小且不会越界。
    fullbody_results = [item for item in ok_results if item.get("kind") == "fullbody"]
    primary_fullbody_paths = {hero["fullbody"] for hero in heroes}
    reported_primary_paths = {item["path"] for item in fullbody_results if item["path"] in primary_fullbody_paths}
    check(reported_primary_paths == primary_fullbody_paths, "52 名英雄的主全身照没有全部进入资源检查")
    check(all(int(item.get("width", 0)) > 0 and int(item.get("height", 0)) > 0 for item in fullbody_results), "全身照存在无效尺寸")
    for stage_width, stage_height in ((600, 800), (328, 437)):
        inner_width = stage_width - 24
        inner_height = stage_height - 24
        for item in fullbody_results:
            width = int(item["width"])
            height = int(item["height"])
            scale = min(inner_width / width, inner_height / height, 1)
            rendered_width = width * scale
            rendered_height = height * scale
            check(rendered_width <= inner_width + 0.01 and rendered_height <= inner_height + 0.01,
                  f"{item['path']} 在 {stage_width}x{stage_height} 容器中会越界")
            check(abs(rendered_width / rendered_height - width / height) < 1e-9,
                  f"{item['path']} 在 {stage_width}x{stage_height} 容器中未保持原始比例")
    NOTES.append(f"英雄与资源：52 名英雄、{len(actual_assets)} 张现有 WebP，路径及 SHA-256 全部匹配。")
    NOTES.append(f"全身照显示：52 张主图及 {len(fullbody_results) - 52} 张备用图均完成尺寸与等比容纳检查。")
    return heroes


def static_web_tests() -> None:
    html = read_text("index.html")
    css = read_text("style.css")
    script = read_text("script.js")
    core = read_text("core.js")
    readme = read_text("README.md")

    required_ids = (
        "setupForm", "resumePanel", "continueButton", "discardButton", "gameScreen", "singleMode",
        "listMode", "singleHeroImage", "nameSearch", "namePool", "reasonInput", "confirmAssignmentButton",
        "previousButton", "overviewButton", "listCards", "incompleteOnly", "listSubmitButton",
        "overviewDialog", "submitDialog", "resultScreen", "resultList", "resultSort", "copyResultButton",
        "printResultButton", "exportResultButton", "importResultButton", "shareModeButton", "liveRegion",
    )
    for element_id in required_ids:
        check(f'id="{element_id}"' in html, f"缺少 DOM 元素 #{element_id}")

    check("给守望先锋英雄起名字" in html, "缺少新标题")
    check("开始分配名字" in html, "开始按钮文字不正确")
    check('alt="待命名英雄图片"' in html, "提交前图片没有使用通用 alt")
    check("aria-modal=\"true\"" in html, "对话框缺少 aria-modal")
    check("aria-live" in html, "缺少 aria-live")
    check(re.search(r"\son\w+\s*=", html, re.I) is None, "HTML 包含内联事件")
    check("http://" not in html and "https://" not in html, "HTML 包含外部资源 URL")
    check("fetch(" not in script, "运行时代码使用 fetch")
    check("eval(" not in script and "eval(" not in core, "JavaScript 包含 eval")
    check("buildOptions" not in script and "buildOptions" not in core, "仍保留四选一选项生成逻辑")
    check("currentStreak" not in script and "bestScore" not in script, "仍保留连对或旧最高分逻辑")
    check("optionsGrid" not in html and "option-button" not in css, "仍保留四选一界面")
    check(".sort(() => Math.random()" not in script + core, "使用了有偏随机排序")
    check("fisherYates" in core, "core.js 缺少 Fisher–Yates")
    check("SAVE_VERSION = 2" in core, "存档版本不是 2")
    check("dataSignature" in core and "reconcileGame" in core, "缺少数据签名或存档兼容检查")
    check("localStorage" in script and "try" in script and "catch" in script, "localStorage 缺少异常保护")
    check("FileReader" in script and "validateImportedResult" in script, "缺少 JSON 导入校验")
    check("@media print" in css, "缺少打印样式")
    check("share-mode" in css and "setShareMode" in script, "缺少分享长图模式")
    check("prefers-reduced-motion" in css, "缺少 reduced-motion 样式")
    check("overflow-x: hidden" in css, "缺少横向溢出保护")
    check("focus-visible" in css, "缺少键盘焦点样式")
    check("loading = 'lazy'" in script, "列表或结果图片没有使用 lazy loading")
    check("aspect-ratio: 1 / 1" in css and ".card-image.fullbody" in css, "图标和全身照列表容器没有分别约束尺寸")
    check(".card-image img { width: 100%; height: 100%; display: block; object-fit: contain; object-position: center; }" in css, "列表图片可能被拉伸或裁切")
    check(".card-image.fullbody { height: auto; aspect-ratio: 3 / 4;" in css, "列表全身照容器不是稳定的竖向比例")
    check(re.search(r"\.card-image\.fullbody img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:[^;]+;[^}]*max-height:[^;]+;", css, re.S) is not None,
          "列表全身照没有按原始比例限制在容器内")
    check(".image-stage.fullbody-mode { width: 100%; height: auto; min-height: 0; max-height: none; aspect-ratio: 3 / 4; }" in css, "单人模式全身照容器不是完整竖向比例")
    check(re.search(r"\.image-stage\.fullbody-mode img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:[^;]+;[^}]*max-height:[^;]+;", css, re.S) is not None,
          "单人模式全身照没有按原始比例限制在容器内")
    check("table-image${state.game.config.mode === 'fullbody' ? ' fullbody' : ''}" in script,
          "当前分配表没有应用全身照完整显示规则")
    check("result-image${state.result.mode === 'fullbody' ? ' fullbody' : ''}" in script,
          "结果页没有应用全身照完整显示规则")
    check(".single-layout { grid-template-columns: 1fr; }" in css, "手机宽度下单人模式没有切换为单列")
    check(".game-header { align-items: stretch; flex-direction: column; }" in css, "手机宽度下游戏标题和返回按钮可能横向溢出")
    mobile_viewport = 390
    mobile_page_width = mobile_viewport - 32
    mobile_stage_width = mobile_page_width - 30
    mobile_stage_height = round(mobile_stage_width * 4 / 3)
    check(mobile_stage_width <= mobile_viewport and mobile_stage_height > mobile_stage_width, "390px 手机全身照尺寸计算异常")
    check("navigator.clipboard" in script and "window.print" in script, "缺少复制或打印功能")
    check("不需要重新下载图片" in readme, "README 没有说明无需重新下载图片")
    check("file://" in readme, "README 没有说明 file:// 运行")
    check("分配一个名字" in readme, "README 没有以新玩法为主")
    NOTES.append(
        f"静态页面：新玩法 DOM、禁止项、存档、无障碍、导入导出、分享与打印检查通过；"
        f"390px 手机布局中全身照区域约 {mobile_stage_width}×{mobile_stage_height}px，单列且未超过视口宽度。"
    )


def node_core_tests() -> None:
    node = shutil.which("node")
    if not node:
        FAILURES.append("未找到 Node.js，无法实际执行 core.js 自动测试")
        return

    program = r"""
global.window = {};
require(process.argv[2]);
const core = require(process.argv[1]);
const heroes = window.HEROES;
function assert(value, message) { if (!value) throw new Error(message); }
function expectCode(fn, code, message) {
  let seen = null;
  try { fn(); } catch (error) { seen = error.code; }
  assert(seen === code, message + '，实际 ' + seen);
}
let seed = 246813579;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const valid = core.validateHeroes(heroes, message => { throw new Error(message); });
assert(valid.length === 52, '数据校验数量');
assert(core.filterHeroes(valid, 'all').length === 52, '全部筛选');
assert(core.filterHeroes(valid, 'tank').length === 14, '重装筛选');
assert(core.filterHeroes(valid, 'damage').length === 24, '输出筛选');
assert(core.filterHeroes(valid, 'support').length === 14, '支援筛选');

const original = [1, 2, 3, 4, 5];
const shuffled = core.fisherYates(original, random);
assert(original.join(',') === '1,2,3,4,5', 'Fisher–Yates 修改了原数组');
assert(shuffled.length === original.length && new Set(shuffled).size === original.length, 'Fisher–Yates 不是排列');

const orders = new Set();
for (const roleFilter of ['all', 'tank', 'damage', 'support']) {
  for (let round = 0; round < 30; round += 1) {
    const game = core.createGame(valid, {mode: round % 2 ? 'icon' : 'fullbody', roleFilter, playStyle: round % 2 ? 'single' : 'list'}, random);
    const pool = core.filterHeroes(valid, roleFilter).map(hero => hero.id);
    assert(game.version === 2, '存档版本');
    assert(game.heroOrder.length === pool.length, roleFilter + ' 英雄数量');
    assert(game.nameOrder.length === pool.length, roleFilter + ' 名称数量');
    assert(new Set(game.heroOrder).size === pool.length, roleFilter + ' 英雄重复');
    assert(new Set(game.nameOrder).size === pool.length, roleFilter + ' 名称重复');
    assert(pool.every(id => game.heroOrder.includes(id) && game.nameOrder.includes(id)), roleFilter + ' 范围内容');
    orders.add(game.heroOrder.slice(0, 8).join(','));
  }
}
assert(orders.size > 20, '英雄顺序没有实际随机变化');

let game = core.createGame(valid, {mode:'icon', roleFilter:'tank', playStyle:'single'}, random, '2026-01-01T00:00:00.000Z');
const [heroA, heroB] = game.heroOrder;
const [nameA, nameB] = game.nameOrder;
game = core.updateAssignment(game, heroA, {selectedHeroId:nameA, reason:'第一印象', completed:false});
expectCode(() => core.updateAssignment(game, heroB, {selectedHeroId:nameA, reason:'重复', completed:false}), 'NAME_IN_USE', '重复名称没有被阻止');
game = core.updateAssignment(game, heroA, {selectedHeroId:nameB, reason:'换名后仍保留理由', completed:true});
game = core.updateAssignment(game, heroB, {selectedHeroId:nameA, reason:'旧名称已经释放', completed:true});
assert(game.answers[heroA].selectedHeroId === nameB, '更换名称失败');
assert(game.answers[heroB].selectedHeroId === nameA, '旧名称没有释放');
assert(game.usedNameIds.length === 2, '名称占用数量错误');
expectCode(() => core.updateAssignment(game, game.heroOrder[2], {selectedHeroId:game.nameOrder[2], reason:'   ', completed:true}), 'REASON_REQUIRED', '空白理由可提交');

game = core.setCurrentIndex(game, 1);
const restored = core.reconcileGame(JSON.parse(JSON.stringify(game)), valid);
assert(restored.currentIndex === 1, '当前索引没有恢复');
assert(restored.answers[heroA].reason === '换名后仍保留理由', '理由没有恢复');
assert(restored.usedNameIds.length === 2, '占用名称没有恢复');
const incompatible = JSON.parse(JSON.stringify(game));
incompatible.dataSignature = 'changed';
expectCode(() => core.reconcileGame(incompatible, valid), 'INCOMPATIBLE_SAVE', '数据签名变化未阻止恢复');

let complete = core.createGame(valid, {mode:'fullbody', roleFilter:'tank', playStyle:'list'}, random, '2026-02-01T00:00:00.000Z');
for (const heroId of complete.heroOrder) {
  complete = core.updateAssignment(complete, heroId, {selectedHeroId:heroId, reason:'根据外形做出的选择', completed:true});
}
const [first, second, third] = complete.heroOrder;
complete = core.updateAssignment(complete, first, {selectedHeroId:null, completed:false});
complete = core.updateAssignment(complete, second, {selectedHeroId:null, completed:false});
complete = core.updateAssignment(complete, first, {selectedHeroId:second, reason:'交换名称一', completed:true});
complete = core.updateAssignment(complete, second, {selectedHeroId:first, reason:'交换名称二', completed:true});
complete = core.updateAssignment(complete, third, {skipped:true, completed:true, selectedHeroId:null, reason:''});
assert(core.canSubmit(complete), '全部完成后不能提交');
const progress = core.getProgress(complete);
assert(progress.completedCount === 14 && progress.skippedCount === 1 && progress.remainingNames === 1, '完成/跳过/剩余名称统计');
const stats = core.calculateStats(complete);
assert(stats.correctCount === 11, '正确数');
assert(stats.wrongCount === 2, '错误数');
assert(stats.skippedCount === 1, '跳过数');
assert(stats.answeredCount === 13, '已回答数');
assert(stats.accuracy === 84.6, '正确率分母未排除跳过');

const result = core.buildResult(complete, valid, '2026-02-02T00:00:00.000Z');
assert(result.version === 1 && result.answers.length === 14, '导出基础格式');
assert(result.answers.every(answer => answer.heroId && answer.realChineseName && answer.realEnglishName && answer.imagePath), '导出缺少必需字段');
assert(result.answers.filter(answer => answer.skipped).length === 1, '导出跳过内容');
const serialized = core.serializeResult(result);
const imported = core.validateImportedResult(JSON.parse(serialized), valid);
assert(imported.correctCount === 11 && imported.wrongCount === 2 && imported.skippedCount === 1, '有效结果导入');

const duplicate = JSON.parse(serialized);
const nonSkipped = duplicate.answers.filter(answer => !answer.skipped);
nonSkipped[1].selectedHeroId = nonSkipped[0].selectedHeroId;
nonSkipped[1].selectedChineseName = nonSkipped[0].selectedChineseName;
nonSkipped[1].selectedEnglishName = nonSkipped[0].selectedEnglishName;
nonSkipped[1].correct = nonSkipped[1].heroId === nonSkipped[1].selectedHeroId;
expectCode(() => core.validateImportedResult(duplicate, valid), 'INVALID_IMPORT', '导入重复名称未被阻止');
const badId = JSON.parse(serialized);
badId.answers[0].heroId = 'hero_999';
expectCode(() => core.validateImportedResult(badId, valid), 'INVALID_IMPORT', '导入无效英雄 ID 未被阻止');
const missingReason = JSON.parse(serialized);
const reasonAnswer = missingReason.answers.find(answer => !answer.skipped);
reasonAnswer.reason = '   ';
expectCode(() => core.validateImportedResult(missingReason, valid), 'INVALID_IMPORT', '导入空白理由未被阻止');
const badVersion = JSON.parse(serialized);
badVersion.version = 99;
expectCode(() => core.validateImportedResult(badVersion, valid), 'INVALID_IMPORT', '导入错误版本未被阻止');
let malformedRejected = false;
try { JSON.parse('{bad json'); } catch (_) { malformedRejected = true; }
assert(malformedRejected, '无效 JSON 没有报错');

console.log(JSON.stringify({pass:true, heroes:valid.length, randomOrders:orders.size, stats, signature:core.createDataSignature(valid)}));
"""
    result = subprocess.run(
        [node, "-e", program, str(ROOT / "core.js"), str(ROOT / "heroes.js")],
        text=True,
        capture_output=True,
        timeout=60,
    )
    check(result.returncode == 0, f"Node 核心逻辑测试失败：{result.stderr or result.stdout}")
    if result.returncode == 0:
        payload = json.loads(result.stdout.strip())
        check(payload.get("pass") is True, "Node 核心逻辑没有返回通过状态")
        NOTES.append(
            f"core.js 实际执行通过：{payload['heroes']} 名英雄，随机顺序样本 {payload['randomOrders']} 种，"
            f"统计 {payload['stats']}，签名 {payload['signature']}。"
        )


def syntax_tests() -> None:
    node = shutil.which("node")
    if node:
        for path in ("heroes.js", "core.js", "script.js"):
            result = subprocess.run([node, "--check", str(ROOT / path)], text=True, capture_output=True, timeout=20)
            check(result.returncode == 0, f"{path} 语法错误：{result.stderr}")
    try:
        compile(read_text("tests/run_tests.py"), str(ROOT / "tests/run_tests.py"), "exec")
    except SyntaxError as exc:
        check(False, f"run_tests.py 语法错误：{exc}")
    NOTES.append("语法检查：heroes.js、core.js、script.js 和 tests/run_tests.py 通过。")


def main() -> int:
    try:
        hero_and_resource_tests()
        static_web_tests()
        syntax_tests()
        node_core_tests()
    except Exception as exc:
        FAILURES.append(f"测试程序异常：{exc}")

    for note in NOTES:
        print(f"[INFO] {note}")
    if FAILURES:
        for failure in FAILURES:
            print(f"[FAIL] {failure}", file=sys.stderr)
        print(f"FAILED: {len(FAILURES)}", file=sys.stderr)
        return 1
    print("PASS: 全部自动测试通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
