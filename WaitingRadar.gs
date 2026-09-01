/**
 * Waiting Radar
 *
 * 以既有「等待他人／待確認」狀態與工作紀錄推導目前等待週期，
 * 不修改 19 欄核心任務契約。只有使用者按下「已追蹤」時，才會
 * 建立／更新輔助工作表「等待追蹤」，保存最近追蹤、下次追蹤與次數。
 */

const WAITING_RADAR_CONFIG = Object.freeze({
  SHEET: "等待追蹤",
  HEADERS: Object.freeze([
    "任務ID",
    "等待開始",
    "最近追蹤",
    "下次追蹤",
    "追蹤次數",
    "更新時間",
  ]),
  DEFAULT_FOLLOW_UP_DAYS: 3,
  STALE_DAYS: 7,
  MAX_ITEMS: 12,
});

/** 管理台讀取 Waiting Radar；讀取本身不建立任何工作表。 */
function getWaitingRadar() {
  assertAuthorized_();
  return buildWaitingRadar_();
}

/**
 * 將一項等待中的任務標記為「已追蹤」，並排定下一次追蹤。
 * 寫入符合既有安全契約：登入檢查、CSRF、共享鎖、工作紀錄。
 */
function markWaitingFollowUp(taskId, followUpDays, csrfToken) {
  const user = assertAuthorized_();
  verifyCsrfToken_(csrfToken);

  const normalizedTaskId = cleanText_(taskId, 120);
  if (!normalizedTaskId) throw new Error("缺少任務 ID。");

  const days = waitingRadarClampDays_(followUpDays);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const radarBefore = buildWaitingRadar_();
    const item = radarBefore.items.find(
      (entry) => entry.taskId === normalizedTaskId,
    );
    if (!item) {
      throw new Error("此任務目前不是等待狀態，無法登記追蹤。");
    }

    const ss = getSpreadsheet_();
    const sheet = ensureWaitingRadarSheet_(ss);
    const headerMap = getHeaderMap_(sheet);
    const rowNumber = findWaitingRadarRow_(sheet, headerMap, normalizedTaskId);
    const beforeState = rowNumber
      ? waitingRadarRowToObject_(sheet, rowNumber, headerMap)
      : null;

    const now = new Date();
    const waitingSince =
      parseDateTime_(item.waitingSince) ||
      (beforeState && beforeState.waitingSince) ||
      now;
    const sameCycle =
      beforeState &&
      beforeState.waitingSince &&
      waitingRadarSameMoment_(beforeState.waitingSince, waitingSince);
    const followUpCount =
      (sameCycle ? Number(beforeState.followUpCount) || 0 : 0) + 1;
    const nextFollowUp = waitingRadarAddCalendarDays_(startOfToday_(), days);

    const values = Array(WAITING_RADAR_CONFIG.HEADERS.length).fill("");
    values[headerMap["任務ID"] - 1] = normalizedTaskId;
    values[headerMap["等待開始"] - 1] = waitingSince;
    values[headerMap["最近追蹤"] - 1] = now;
    values[headerMap["下次追蹤"] - 1] = nextFollowUp;
    values[headerMap["追蹤次數"] - 1] = followUpCount;
    values[headerMap["更新時間"] - 1] = now;

    const targetRow =
      rowNumber || Math.max(sheet.getLastRow() + 1, APP_CONFIG.DATA_START_ROW);
    sheet
      .getRange(targetRow, 1, 1, WAITING_RADAR_CONFIG.HEADERS.length)
      .setValues([values]);
    applyWaitingRadarRowFormats_(sheet, targetRow, headerMap);

    const afterState = waitingRadarRowToObject_(sheet, targetRow, headerMap);
    appendLog_(
      ss,
      normalizedTaskId,
      `Waiting Radar 追蹤（下次 ${formatDateOnly_(nextFollowUp)}）`,
      beforeState,
      afterState,
      user.email || user.name,
    );
    SpreadsheetApp.flush();

    return {
      ok: true,
      message: `已記錄追蹤；${days} 天後再次提醒。`,
      radar: buildWaitingRadar_(),
    };
  } finally {
    lock.releaseLock();
  }
}

/** 建立管理台需要的 Waiting Radar 投影。 */
function buildWaitingRadar_() {
  const now = new Date();
  const today = startOfToday_();
  const waitingTasks = listTasks_({ includeArchived: false }).filter((task) =>
    isWaitingStatus_(task.status),
  );

  if (!waitingTasks.length) {
    return {
      summary: {
        waiting: 0,
        needsAttention: 0,
        dueToday: 0,
        stale: 0,
        longestWaitDays: 0,
      },
      items: [],
      config: waitingRadarClientConfig_(),
      serverTime: formatDateTime_(now),
    };
  }

  const stateMap = readWaitingRadarStateMap_();
  const cycleMap = buildWaitingCycleMap_(waitingTasks.map((task) => task.taskId));

  const items = waitingTasks.map((task) => {
    const saved = stateMap[task.taskId] || null;
    const loggedWaitingSince = cycleMap[task.taskId] || null;
    const savedWaitingSince = saved && saved.waitingSince ? saved.waitingSince : null;

    // 若工作紀錄可辨識目前等待週期，以紀錄為準；否則沿用本輪 Radar 狀態，
    // 最後才退回任務更新／建立時間。這可避免一般編輯把等待天數歸零。
    const waitingSince =
      loggedWaitingSince ||
      savedWaitingSince ||
      parseDateTime_(task.updatedAt) ||
      parseDateTime_(task.createdAt) ||
      now;

    const stateMatchesCycle = Boolean(
      saved &&
        savedWaitingSince &&
        (!loggedWaitingSince ||
          waitingRadarSameMoment_(savedWaitingSince, waitingSince)),
    );
    const lastFollowUp =
      stateMatchesCycle && saved.lastFollowUp ? saved.lastFollowUp : null;
    const nextFollowUp =
      stateMatchesCycle && saved.nextFollowUp
        ? saved.nextFollowUp
        : waitingRadarAddCalendarDays_(
            waitingRadarStartOfDay_(waitingSince),
            WAITING_RADAR_CONFIG.DEFAULT_FOLLOW_UP_DAYS,
          );
    const followUpCount =
      stateMatchesCycle && saved ? Number(saved.followUpCount) || 0 : 0;

    const daysWaiting = Math.max(
      0,
      waitingRadarCalendarDayDiff_(waitingSince, today),
    );
    const isFollowUpOverdue =
      waitingRadarStartOfDay_(nextFollowUp).getTime() < today.getTime();
    const dueToday = sameDate_(nextFollowUp, today);
    const stale = daysWaiting >= WAITING_RADAR_CONFIG.STALE_DAYS;
    const missingWaitingFor = !String(task.waitingFor || "").trim();
    const needsAttention = isFollowUpOverdue || stale || missingWaitingFor;
    const level = needsAttention ? "attention" : dueToday ? "due" : "watch";

    return {
      taskId: task.taskId,
      name: task.name,
      category: task.category,
      status: task.status,
      priority: task.priority,
      waitingFor: task.waitingFor || "",
      nextAction: task.nextAction || "",
      progress: task.progress || "",
      owner: task.owner || "",
      detailUrl: task.detailUrl || "",
      waitingSince: formatDateTime_(waitingSince),
      lastFollowUpAt: lastFollowUp ? formatDateTime_(lastFollowUp) : "",
      nextFollowUpDate: formatDateOnly_(nextFollowUp),
      followUpCount,
      daysWaiting,
      dueToday,
      stale,
      needsAttention,
      level,
      reason: waitingRadarReason_(
        missingWaitingFor,
        isFollowUpOverdue,
        stale,
        dueToday,
        daysWaiting,
      ),
    };
  });

  items.sort(compareWaitingRadarItems_);
  const visibleItems = items.slice(0, WAITING_RADAR_CONFIG.MAX_ITEMS);
  return {
    summary: {
      waiting: items.length,
      needsAttention: items.filter((item) => item.needsAttention).length,
      dueToday: items.filter((item) => item.dueToday).length,
      stale: items.filter((item) => item.stale).length,
      longestWaitDays: items.reduce(
        (max, item) => Math.max(max, item.daysWaiting),
        0,
      ),
    },
    items: visibleItems,
    hasMore: items.length > visibleItems.length,
    config: waitingRadarClientConfig_(),
    serverTime: formatDateTime_(now),
  };
}

function waitingRadarClientConfig_() {
  return {
    defaultFollowUpDays: WAITING_RADAR_CONFIG.DEFAULT_FOLLOW_UP_DAYS,
    staleDays: WAITING_RADAR_CONFIG.STALE_DAYS,
    maxItems: WAITING_RADAR_CONFIG.MAX_ITEMS,
  };
}

/** 從工作紀錄重建「目前這一輪」等待開始時間。 */
function buildWaitingCycleMap_(taskIds) {
  const ids = new Set((taskIds || []).filter(Boolean));
  const cycles = {};
  if (!ids.size) return cycles;

  const ss = getSpreadsheet_();
  const sheet = getRequiredSheet_(ss, APP_CONFIG.LOG_SHEET);
  if (sheet.getLastRow() < APP_CONFIG.DATA_START_ROW) return cycles;

  const headerMap = getHeaderMap_(sheet);
  const rows = sheet
    .getRange(
      APP_CONFIG.DATA_START_ROW,
      1,
      sheet.getLastRow() - 1,
      LOG_HEADERS.length,
    )
    .getValues();

  rows.forEach((row) => {
    const taskId = String(row[headerMap["任務ID"] - 1] || "").trim();
    if (!ids.has(taskId)) return;

    const beforeStatus = waitingRadarExtractStatus_(
      row[headerMap["變更前"] - 1],
    );
    const afterStatus = waitingRadarExtractStatus_(
      row[headerMap["變更後"] - 1],
    );
    if (!afterStatus) return;

    const beforeWaiting = isWaitingStatus_(beforeStatus);
    const afterWaiting = isWaitingStatus_(afterStatus);
    const timestamp = waitingRadarCoerceDate_(row[headerMap["時間"] - 1]);
    if (!timestamp) return;

    if (afterWaiting && !beforeWaiting) {
      cycles[taskId] = timestamp;
      return;
    }
    if (!afterWaiting && beforeWaiting) {
      cycles[taskId] = null;
    }
  });
  return cycles;
}

/** appendLog_ 可能存完整 task JSON，也可能存直接編輯時的單一狀態字串。 */
function waitingRadarExtractStatus_(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const direct = String(value.status || "").trim();
    if (COMMON_OPTION_LISTS.狀態.includes(direct)) return direct;
  }

  const text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) return "";
  if (COMMON_OPTION_LISTS.狀態.includes(text)) return text;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const status = String(parsed.status || "").trim();
      if (COMMON_OPTION_LISTS.狀態.includes(status)) return status;
    }
  } catch (_) {
    // 非 JSON 的工作紀錄是合法情況；直接略過。
  }
  return "";
}

function readWaitingRadarStateMap_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(WAITING_RADAR_CONFIG.SHEET);
  if (!sheet || sheet.getLastRow() < APP_CONFIG.DATA_START_ROW) return {};

  assertWaitingRadarHeaders_(sheet);
  const headerMap = getHeaderMap_(sheet);
  const rows = sheet
    .getRange(
      APP_CONFIG.DATA_START_ROW,
      1,
      sheet.getLastRow() - 1,
      WAITING_RADAR_CONFIG.HEADERS.length,
    )
    .getValues();

  return rows.reduce((map, row) => {
    const taskId = String(row[headerMap["任務ID"] - 1] || "").trim();
    if (!taskId) return map;
    map[taskId] = waitingRadarArrayToObject_(row, headerMap);
    return map;
  }, {});
}

function ensureWaitingRadarSheet_(ss) {
  let sheet = ss.getSheetByName(WAITING_RADAR_CONFIG.SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(WAITING_RADAR_CONFIG.SHEET);
    sheet
      .getRange(1, 1, 1, WAITING_RADAR_CONFIG.HEADERS.length)
      .setValues([[...WAITING_RADAR_CONFIG.HEADERS]]);
    styleHeader_(sheet.getRange(1, 1, 1, WAITING_RADAR_CONFIG.HEADERS.length));
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 190);
    sheet.setColumnWidths(2, 3, 150);
    sheet.setColumnWidth(5, 95);
    sheet.setColumnWidth(6, 150);
  } else {
    assertWaitingRadarHeaders_(sheet);
  }
  return sheet;
}

function assertWaitingRadarHeaders_(sheet) {
  const actual = sheet
    .getRange(1, 1, 1, WAITING_RADAR_CONFIG.HEADERS.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const mismatch = WAITING_RADAR_CONFIG.HEADERS.findIndex(
    (header, index) => actual[index] !== header,
  );
  if (mismatch >= 0) {
    throw new Error(
      `工作表「${WAITING_RADAR_CONFIG.SHEET}」第 ${mismatch + 1} 欄應為「${WAITING_RADAR_CONFIG.HEADERS[mismatch]}」。`,
    );
  }
}

function findWaitingRadarRow_(sheet, headerMap, taskId) {
  if (sheet.getLastRow() < APP_CONFIG.DATA_START_ROW) return 0;
  const match = sheet
    .getRange(
      APP_CONFIG.DATA_START_ROW,
      headerMap["任務ID"],
      sheet.getLastRow() - 1,
      1,
    )
    .createTextFinder(String(taskId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function waitingRadarRowToObject_(sheet, rowNumber, headerMap) {
  const row = sheet
    .getRange(rowNumber, 1, 1, WAITING_RADAR_CONFIG.HEADERS.length)
    .getValues()[0];
  return waitingRadarArrayToObject_(row, headerMap);
}

function waitingRadarArrayToObject_(row, headerMap) {
  const get = (header) => row[headerMap[header] - 1];
  return {
    taskId: String(get("任務ID") || "").trim(),
    waitingSince: waitingRadarCoerceDate_(get("等待開始")),
    lastFollowUp: waitingRadarCoerceDate_(get("最近追蹤")),
    nextFollowUp: waitingRadarCoerceDate_(get("下次追蹤")),
    followUpCount: Number(get("追蹤次數")) || 0,
    updatedAt: waitingRadarCoerceDate_(get("更新時間")),
  };
}

function applyWaitingRadarRowFormats_(sheet, rowNumber, headerMap) {
  ["等待開始", "最近追蹤", "更新時間"].forEach((header) => {
    sheet
      .getRange(rowNumber, headerMap[header])
      .setNumberFormat("yyyy/mm/dd hh:mm:ss");
  });
  sheet
    .getRange(rowNumber, headerMap["下次追蹤"])
    .setNumberFormat("yyyy/mm/dd");
  sheet
    .getRange(rowNumber, headerMap["追蹤次數"])
    .setNumberFormat("0");
}

function compareWaitingRadarItems_(a, b) {
  const levelWeight = { attention: 0, due: 1, watch: 2 };
  const priorityWeight = { 高: 0, 中: 1, 低: 2 };
  const levelDiff =
    (levelWeight[a.level] ?? 9) - (levelWeight[b.level] ?? 9);
  if (levelDiff !== 0) return levelDiff;

  const nextA = parseDateOnly_(a.nextFollowUpDate);
  const nextB = parseDateOnly_(b.nextFollowUpDate);
  const dateDiff =
    (nextA ? nextA.getTime() : Number.MAX_SAFE_INTEGER) -
    (nextB ? nextB.getTime() : Number.MAX_SAFE_INTEGER);
  if (dateDiff !== 0) return dateDiff;

  const priorityDiff =
    (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9);
  if (priorityDiff !== 0) return priorityDiff;
  return b.daysWaiting - a.daysWaiting;
}

function waitingRadarReason_(
  missingWaitingFor,
  isFollowUpOverdue,
  stale,
  dueToday,
  daysWaiting,
) {
  if (missingWaitingFor) return "等待對象尚未填寫";
  if (isFollowUpOverdue) return "追蹤日期已過，應主動確認進度";
  if (stale) return `已等待 ${daysWaiting} 天，建議重新判斷卡點`;
  if (dueToday) return "今天是預定追蹤日";
  return `已等待 ${daysWaiting} 天，持續觀察`;
}

function waitingRadarClampDays_(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return WAITING_RADAR_CONFIG.DEFAULT_FOLLOW_UP_DAYS;
  }
  return Math.min(30, Math.max(1, Math.trunc(number)));
}

function waitingRadarSameMoment_(a, b) {
  const left = waitingRadarCoerceDate_(a);
  const right = waitingRadarCoerceDate_(b);
  if (!left || !right) return false;
  return Math.abs(left.getTime() - right.getTime()) < 60000;
}

function waitingRadarCoerceDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = parseDateTime_(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function waitingRadarStartOfDay_(value) {
  const date = waitingRadarCoerceDate_(value) || new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function waitingRadarAddCalendarDays_(value, days) {
  const result = waitingRadarStartOfDay_(value);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function waitingRadarCalendarDayDiff_(from, to) {
  const start = waitingRadarStartOfDay_(from);
  const end = waitingRadarStartOfDay_(to);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}
