const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const radarPath = path.join(projectRoot, "WaitingRadar.gs");
const radarSource = fs.readFileSync(radarPath, "utf8");
const indexSource = fs.readFileSync(path.join(projectRoot, "Index.html"), "utf8");
const codeSource = fs.readFileSync(path.join(projectRoot, "Code.gs"), "utf8");

const statuses = ["未開始", "進行中", "等待他人", "待確認", "已完成", "暫停", "取消"];
const context = vm.createContext({
  COMMON_OPTION_LISTS: { 狀態: statuses },
  parseDateTime_: (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    const normalized = String(value).replace(" ", "T");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
});

vm.runInContext(
  `${radarSource}\nglobalThis.__exports = {
    WAITING_RADAR_CONFIG,
    waitingRadarExtractStatus_,
    waitingRadarClampDays_,
    waitingRadarSameMoment_,
    waitingRadarAddCalendarDays_,
    waitingRadarCalendarDayDiff_,
    waitingRadarReason_
  };`,
  context,
  { filename: "WaitingRadar.gs" },
);

const {
  WAITING_RADAR_CONFIG,
  waitingRadarExtractStatus_,
  waitingRadarClampDays_,
  waitingRadarSameMoment_,
  waitingRadarAddCalendarDays_,
  waitingRadarCalendarDayDiff_,
  waitingRadarReason_,
} = context.__exports;

assert.equal(WAITING_RADAR_CONFIG.SHEET, "等待追蹤");
assert.equal(WAITING_RADAR_CONFIG.DEFAULT_FOLLOW_UP_DAYS, 3);
assert.equal(WAITING_RADAR_CONFIG.STALE_DAYS, 7);
assert.deepEqual(
  Array.from(WAITING_RADAR_CONFIG.HEADERS),
  ["任務ID", "等待開始", "最近追蹤", "下次追蹤", "追蹤次數", "更新時間"],
);

assert.equal(waitingRadarExtractStatus_("等待他人"), "等待他人");
assert.equal(waitingRadarExtractStatus_("待確認"), "待確認");
assert.equal(
  waitingRadarExtractStatus_(JSON.stringify({ status: "等待他人", name: "測試" })),
  "等待他人",
);
assert.equal(waitingRadarExtractStatus_("不是狀態"), "");

assert.equal(waitingRadarClampDays_(undefined), 3);
assert.equal(waitingRadarClampDays_(0), 1);
assert.equal(waitingRadarClampDays_(99), 30);
assert.equal(waitingRadarClampDays_(7), 7);
assert.equal(
  waitingRadarCalendarDayDiff_("2026-08-28 09:00:00", "2026-09-01 08:00:00"),
  4,
);
assert.equal(
  waitingRadarAddCalendarDays_("2026-09-01 08:00:00", 3).getDate(),
  4,
);
assert.equal(
  waitingRadarSameMoment_("2026-09-01 08:00:00", "2026-09-01 08:00:30"),
  true,
);
assert.equal(
  waitingRadarReason_(true, false, false, false, 1),
  "等待對象尚未填寫",
);
assert.match(
  waitingRadarReason_(false, true, false, false, 4),
  /追蹤日期已過/,
);

assert.match(radarSource, /function getWaitingRadar\(\)/, "應提供 Radar 讀取端點");
assert.match(radarSource, /function markWaitingFollowUp\(/, "應提供追蹤寫入端點");
assert.match(radarSource, /assertAuthorized_\(\)/, "Radar 必須保留登入授權");
assert.match(radarSource, /verifyCsrfToken_\(csrfToken\)/, "追蹤寫入必須驗證 CSRF");
assert.match(radarSource, /LockService\.getScriptLock\(\)/, "追蹤寫入必須使用共享鎖");
assert.match(radarSource, /appendLog_\(/, "追蹤寫入必須留下工作紀錄");
assert.match(radarSource, /buildWaitingCycleMap_/, "等待開始應從工作紀錄推導，而不是只看更新時間");
assert.doesNotMatch(radarSource, /TASK_HEADERS\s*=|TASK_HEADERS\.push/, "Waiting Radar 不得改寫核心任務欄位契約");

assert.match(indexSource, />Waiting Radar</, "管理台應顯示 Waiting Radar 區塊");
assert.match(indexSource, /serverCall\('getWaitingRadar'\)/, "管理台應載入 Radar 資料");
assert.match(indexSource, /serverCall\('markWaitingFollowUp'/, "管理台應可記錄追蹤");
assert.match(indexSource, /只看等待任務/, "管理台應提供等待任務聚焦操作");

const taskHeadersMatch = codeSource.match(/const TASK_HEADERS = Object\.freeze\(\[([\s\S]*?)\]\);/);
assert.ok(taskHeadersMatch, "找不到 TASK_HEADERS");
const taskHeaderCount = [...taskHeadersMatch[1].matchAll(/^\s*".+",?$/gm)].length;
assert.equal(taskHeaderCount, 19, "Waiting Radar 必須維持既有 19 欄任務契約");

console.log("waiting_radar.test.js: all checks passed");
