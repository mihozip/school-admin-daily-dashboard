/**
 * 校務行政每日任務管理系統
 * Google Apps Script / V8
 *
 * 安裝方式：從目標 Google Sheet 開啟「擴充功能 → Apps Script」，
 * 貼入本專案檔案後，重新整理試算表並從「校務任務系統」選擇處室。
 */

const APP_CONFIG = Object.freeze({
  TIMEZONE: "Asia/Taipei",
  TASK_SHEET: "任務清單",
  LOG_SHEET: "工作紀錄",
  SETTINGS_SHEET: "系統設定",
  OPTIONS_SHEET: "選項清單",
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  MAX_ROWS_FOR_VALIDATION: 2000,
  CSRF_TTL_SECONDS: 21600,
});

const TASK_HEADERS = Object.freeze([
  "任務ID",
  "任務名稱",
  "類型",
  "狀態",
  "優先級",
  "截止日期",
  "截止時間",
  "下一步行動",
  "等待對象",
  "最近進度",
  "負責人",
  "負責人Email",
  "看板顯示",
  "顯示排序",
  "詳細連結",
  "建立時間",
  "更新時間",
  "完成時間",
  "封存",
]);

const LOG_HEADERS = Object.freeze([
  "紀錄ID",
  "任務ID",
  "動作",
  "變更前",
  "變更後",
  "操作者",
  "時間",
]);

const COMMON_OPTION_LISTS = Object.freeze({
  狀態: ["未開始", "進行中", "等待他人", "待確認", "已完成", "暫停", "取消"],
  優先級: ["高", "中", "低"],
  看板顯示: ["自動", "強制顯示", "隱藏"],
  封存: ["否", "是"],
});

/**
 * 處室差異集中於 profile；Sheet、CRUD、安全與看板流程不需要知道各處室細節。
 * 新增處室時只需補一個 profile，無須複製整套系統。
 */
const OFFICE_PROFILES = Object.freeze({
  academic_affairs: Object.freeze({
    name: "教務處",
    description: "課程教學、學籍成績、招生編班與教學資源",
    roles: Object.freeze([
      ["director", "教務主任"],
      ["curriculum_leader", "教學組長"],
      ["registrar_leader", "註冊組長"],
      ["equipment_leader", "設備組長"],
      ["information_leader", "資訊組長"],
    ]),
    categories: Object.freeze([
      "課程教學", "學籍註冊", "成績評量", "招生編班", "教務行政",
      "設備資源", "資訊教育", "教師研習", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["確認下週課務與代課安排", "課程教學", "進行中", "高", "彙整請假與代課需求"],
      ["完成定期評量命題檢核", "成績評量", "待確認", "高", "確認命題範圍與審題紀錄"],
      ["更新轉入生學籍資料", "學籍註冊", "未開始", "中", "核對紙本證明與系統欄位"],
    ]),
  }),
  student_affairs: Object.freeze({
    name: "學務處",
    description: "生活教育、校園安全、活動、體育與衛生保健",
    roles: Object.freeze([
      ["director", "學務主任"],
      ["activities_leader", "訓育組長"],
      ["discipline_leader", "生教組長"],
      ["athletics_leader", "體育組長"],
      ["hygiene_leader", "衛生組長"],
    ]),
    categories: Object.freeze([
      "學生活動", "生活教育", "校園安全", "體育競賽", "衛生保健",
      "社團自治", "獎懲出缺席", "防災", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["確認朝會與本週學生宣導事項", "生活教育", "進行中", "高", "彙整各組宣導內容"],
      ["完成校外教學安全檢核", "校園安全", "待確認", "高", "核對名冊、車籍與緊急聯絡資料"],
      ["更新社團活動場地表", "社團自治", "未開始", "中", "確認衝堂與指導教師"],
    ]),
  }),
  counseling: Object.freeze({
    name: "輔導室",
    description: "學生輔導、生涯發展、特教服務與親師合作",
    roles: Object.freeze([
      ["director", "輔導主任"],
      ["counseling_leader", "輔導組長"],
      ["records_leader", "資料組長"],
      ["special_education_leader", "特教組長"],
    ]),
    categories: Object.freeze([
      "個案輔導", "團體輔導", "生涯教育", "親師合作", "特教服務",
      "轉銜安置", "心理測驗", "資源協調", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["確認本週個案會議資料", "個案輔導", "進行中", "高", "彙整導師觀察與輔導紀錄"],
      ["安排生涯發展講座講師", "生涯教育", "等待他人", "中", "確認講師時段與需求"],
      ["更新特教生轉銜服務進度", "轉銜安置", "待確認", "高", "核對家長與相關單位回覆"],
    ]),
  }),
  general_affairs: Object.freeze({
    name: "總務處",
    description: "採購財產、修繕工程、場地、防災與庶務",
    roles: Object.freeze([
      ["director", "總務主任"],
      ["general_services_leader", "事務組長"],
      ["cashier_leader", "出納組長"],
      ["documents_leader", "文書組長"],
    ]),
    categories: Object.freeze([
      "修繕", "採購", "財產", "場地", "午餐",
      "工程", "防災", "文書", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["確認教學大樓修繕廠商進場時間", "修繕", "等待他人", "高", "確認施工日期、動線與停電範圍"],
      ["完成冷氣採購案規格複核", "採購", "進行中", "高", "確認數量、安裝位置與電力條件"],
      ["更新場地借用與校園開放表", "場地", "未開始", "中", "彙整申請並同步警衛室"],
    ]),
  }),
  personnel: Object.freeze({
    name: "人事室",
    description: "人員任免、差勤、考核、研習與福利",
    roles: Object.freeze([
      ["director", "人事主任"],
      ["officer", "人事管理員"],
    ]),
    categories: Object.freeze([
      "任免遷調", "差勤管理", "考核獎懲", "敘薪待遇", "退休撫卹",
      "教師甄選", "員工協助", "法規宣導", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["確認本月差勤異常名單", "差勤管理", "進行中", "高", "通知同仁補正差勤資料"],
      ["彙整教師成績考核資料", "考核獎懲", "待確認", "高", "核對年資與獎懲紀錄"],
      ["更新人事法規宣導摘要", "法規宣導", "未開始", "中", "整理本月修正重點"],
    ]),
  }),
  accounting: Object.freeze({
    name: "會計室",
    description: "預算、核銷、帳務、採購監辦與決算",
    roles: Object.freeze([
      ["director", "會計主任"],
      ["officer", "會計員"],
    ]),
    categories: Object.freeze([
      "預算控管", "經費核銷", "帳務處理", "採購監辦", "月報決算",
      "補助計畫", "財務稽核", "憑證管理", "會議", "其他",
    ]),
    samples: Object.freeze([
      ["檢核本月經費執行率", "預算控管", "進行中", "高", "比對各計畫預算與實支數"],
      ["完成待核銷憑證複核", "經費核銷", "待確認", "高", "確認用途說明與附件"],
      ["彙整補助計畫收支資料", "補助計畫", "未開始", "中", "通知承辦人補齊成果資料"],
    ]),
  }),
});

const DEFAULT_SETTINGS = Object.freeze([
  ["OFFICE_KEY", "general_affairs", "目前使用的處室代碼"],
  ["OFFICE_NAME", "總務處", "目前使用的處室名稱"],
  ["ROLE_KEY", "director", "目前使用的職務代碼"],
  ["ROLE_NAME", "總務主任", "目前使用的職務名稱"],
  ["SCHOOL_NAME", "", "學校名稱；留空時不顯示"],
  ["SYSTEM_NAME", "總務處｜總務主任每日任務系統", "管理台與看板標題"],
  ["ALLOWED_DOMAIN", "", "限制登入網域，例如 school.edu.tw；留空表示不限制"],
  ["BOARD_REFRESH_MINUTES", "10", "電子紙看板自動更新分鐘數"],
  ["BOARD_MAX_TASKS", "6", "看板最多顯示任務數"],
  ["AUTO_SHOW_DAYS", "7", "自動顯示未來幾天內到期任務"],
  ["DEFAULT_OWNER", "總務主任", "新增任務預設負責人"],
  ["DEFAULT_OWNER_EMAIL", "", "新增任務預設負責人 Email"],
  ["BOARD_SHOW_DONE_TODAY", "是", "看板統計是否顯示今日完成數"],
]);

const HEADER_ALIASES = Object.freeze({
  任務ID: ["任務ID", "任務 Id", "ID", "id"],
  任務名稱: ["任務名稱", "工作項目", "事項", "任務", "名稱"],
  類型: ["類型", "任務類型", "分類"],
  狀態: ["狀態", "進度狀態"],
  優先級: ["優先級", "優先順序", "重要性"],
  截止日期: ["截止日期", "截止日", "期限日期"],
  截止時間: ["截止時間", "時間", "截止時刻", "期限"],
  下一步行動: ["下一步行動", "詳細說明", "說明", "備註"],
  等待對象: ["等待對象", "等候對象"],
  最近進度: ["最近進度", "處理進度", "進度說明"],
  負責人: ["負責人", "承辦人"],
  負責人Email: ["負責人Email", "承辦人Email", "Email", "電子郵件"],
  看板顯示: ["看板顯示", "今日顯示", "顯示"],
  顯示排序: ["顯示排序", "排序"],
  詳細連結: ["詳細連結", "連結", "網址"],
  建立時間: ["建立時間", "建立日期"],
  更新時間: ["更新時間", "最後更新"],
  完成時間: ["完成時間", "完成日期"],
  封存: ["封存", "已封存"],
});

/** 試算表開啟時加入自訂選單。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("校務任務系統")
    .addItem("安裝／選擇處室", "installSystem")
    .addItem("整理格式與下拉選單", "refreshSheetDesign")
    .addSeparator()
    .addItem("開啟管理台與看板", "showWebAppLinks")
    .addItem("系統診斷", "showDiagnosis")
    .addToUi();
}

/**
 * 非破壞式安裝：若需要改欄位，先建立備份，再轉換成標準結構。
 */
function installSystem() {
  showInstallDialog();
}

/** 顯示處室與職務安裝精靈。 */
function showInstallDialog() {
  const html = HtmlService.createHtmlOutputFromFile("Installer")
    .setWidth(620)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, "安裝校務任務系統");
}

/** 提供安裝精靈使用的安全設定資料。 */
function getInstallationOptions() {
  assertSpreadsheetUiContext_();
  const settings = getSettings_();
  return {
    offices: getOfficeProfileCatalog_(),
    installToken: issueInstallToken_(),
    current: {
      officeKey: settings.OFFICE_KEY || "general_affairs",
      roleKey: settings.ROLE_KEY || "director",
      schoolName: settings.SCHOOL_NAME || "",
    },
  };
}

/** 依安裝精靈選擇，非破壞式安裝或切換處室。 */
function installOfficeSystem(
  officeKey,
  roleKey,
  schoolName,
  seedSamples,
  installToken,
) {
  assertSpreadsheetUiContext_();
  assertAuthorized_();
  verifyInstallToken_(installToken);
  const profile = getOfficeProfile_(officeKey);
  const role = profile.roles.find((item) => item[0] === String(roleKey || ""));
  if (!role) throw new Error("所選職務不屬於此處室。");

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = getSpreadsheet_();
    ss.setSpreadsheetTimeZone(APP_CONFIG.TIMEZONE);
    PropertiesService.getScriptProperties().setProperty(
      "BOUND_SPREADSHEET_ID",
      ss.getId(),
    );

    const taskSheet = locateOrCreateTaskSheet_(ss);
    migrateTaskSheet_(ss, taskSheet, profile, role[1], seedSamples !== false);
    applyOfficeProfileSettings_(
      ss,
      String(officeKey),
      profile,
      role[0],
      role[1],
      schoolName,
    );
    const optionLists = getOptionLists_(profile, taskSheet);
    ensureAuxiliarySheets_(ss, optionLists);
    applyTaskSheetDesign_(taskSheet, optionLists);
    ensureInstallableEditTrigger_(ss);

    PropertiesService.getDocumentProperties().setProperty(
      "SYSTEM_INSTALLED_AT",
      new Date().toISOString(),
    );

    SpreadsheetApp.flush();
    return {
      ok: true,
      message: `${profile.name}／${role[1]}已安裝完成。`,
    };
  } finally {
    lock.releaseLock();
  }
}

/** 重新套用欄位格式、下拉選單及條件格式。 */
function refreshSheetDesign() {
  const ss = assertSpreadsheetUiContext_();
  const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
  const optionLists = getOptionLists_(getActiveOfficeContext_().profile, sheet);
  ensureAuxiliarySheets_(ss, optionLists);
  applyTaskSheetDesign_(sheet, optionLists);
  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert("已重新套用工作表格式與資料驗證。");
}

/** Web App 入口。page=board 顯示電子紙看板，預設顯示管理台。 */
function doGet(e) {
  const page = String(
    (e && e.parameter && e.parameter.page) || "manage",
  ).toLowerCase();
  const fileName = page === "board" ? "Board" : "Index";
  const template = HtmlService.createTemplateFromFile(fileName);
  template.appUrl = ScriptApp.getService().getUrl() || "";

  return template
    .evaluate()
    .setTitle(page === "board" ? "校務行政每日任務板" : "校務任務管理台")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
    )
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** 管理台初始化資料。 */
function getBootstrapData() {
  const user = assertAuthorized_();
  const settings = getSettings_();
  const tasks = listTasks_({ includeArchived: false });
  const token = issueCsrfToken_();

  return {
    user,
    settings,
    office: getActiveOfficeContext_(),
    options: getOptionLists_(),
    tasks,
    summary: summarizeTasks_(tasks),
    csrfToken: token,
    serverTime: formatDateTime_(new Date()),
    appUrl: ScriptApp.getService().getUrl() || "",
  };
}

/** 重新取得管理台操作憑證；供前端在長時間開啟後自動續期。 */
function refreshCsrfToken() {
  assertAuthorized_();
  return {
    csrfToken: issueCsrfToken_(),
    serverTime: formatDateTime_(new Date()),
  };
}

/** 重新取得任務；前端篩選主要在瀏覽器完成。 */
function getTasks() {
  assertAuthorized_();
  const tasks = listTasks_({ includeArchived: false });
  return {
    tasks,
    summary: summarizeTasks_(tasks),
    serverTime: formatDateTime_(new Date()),
  };
}

/** 新增或更新任務。 */
function saveTask(payload) {
  const user = assertAuthorized_();
  verifyCsrfToken_(payload && payload.csrfToken);

  const data = normalizePayload_(payload || {});
  validateTaskPayload_(data);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
    const headerMap = getHeaderMap_(sheet);
    const now = new Date();

    let rowNumber = data.taskId
      ? findTaskRowById_(sheet, headerMap, data.taskId)
      : 0;
    const isUpdate = Boolean(rowNumber);
    let before = null;
    let action = "新增任務";

    if (rowNumber) {
      before = rowToTaskObject_(sheet, rowNumber, headerMap);
      action = "更新任務";
    } else {
      rowNumber = Math.max(sheet.getLastRow() + 1, APP_CONFIG.DATA_START_ROW);
      data.taskId = createTaskId_();
      data.createdAt = now;
    }

    const existingCreatedAt =
      before && before.createdAt ? parseDateTime_(before.createdAt) : null;
    data.createdAt = existingCreatedAt || data.createdAt || now;
    data.updatedAt = now;

    if (data.status === "已完成") {
      data.completedAt =
        before && before.completedAt ? parseDateTime_(before.completedAt) : now;
    } else {
      data.completedAt = "";
    }

    const rowValues = taskObjectToRow_(data, headerMap, TASK_HEADERS.length);
    sheet.getRange(rowNumber, 1, 1, TASK_HEADERS.length).setValues([rowValues]);
    applyRowFormats_(sheet, rowNumber, headerMap);

    const after = rowToTaskObject_(sheet, rowNumber, headerMap);
    appendLog_(ss, data.taskId, action, before, after, user.email || user.name);
    SpreadsheetApp.flush();

    const tasks = listTasks_({ includeArchived: false });
    return {
      ok: true,
      message: isUpdate ? "任務已更新" : "任務已新增",
      task: after,
      tasks,
      summary: summarizeTasks_(tasks),
    };
  } finally {
    lock.releaseLock();
  }
}

/** 快速更新狀態。 */
function updateTaskStatus(taskId, status, csrfToken) {
  const user = assertAuthorized_();
  verifyCsrfToken_(csrfToken);
  if (!COMMON_OPTION_LISTS.狀態.includes(String(status || ""))) {
    throw new Error("無效的任務狀態。");
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
    const headerMap = getHeaderMap_(sheet);
    const rowNumber = findTaskRowById_(sheet, headerMap, taskId);
    if (!rowNumber) throw new Error("找不到指定任務。");

    const before = rowToTaskObject_(sheet, rowNumber, headerMap);
    const now = new Date();
    sheet.getRange(rowNumber, headerMap["狀態"]).setValue(status);
    sheet.getRange(rowNumber, headerMap["更新時間"]).setValue(now);
    sheet
      .getRange(rowNumber, headerMap["完成時間"])
      .setValue(status === "已完成" ? now : "");
    applyRowFormats_(sheet, rowNumber, headerMap);

    const after = rowToTaskObject_(sheet, rowNumber, headerMap);
    appendLog_(ss, taskId, "變更狀態", before, after, user.email || user.name);

    const tasks = listTasks_({ includeArchived: false });
    return { ok: true, task: after, tasks, summary: summarizeTasks_(tasks) };
  } finally {
    lock.releaseLock();
  }
}

/** 封存任務，不直接刪除資料。 */
function archiveTask(taskId, csrfToken) {
  const user = assertAuthorized_();
  verifyCsrfToken_(csrfToken);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
    const headerMap = getHeaderMap_(sheet);
    const rowNumber = findTaskRowById_(sheet, headerMap, taskId);
    if (!rowNumber) throw new Error("找不到指定任務。");

    const before = rowToTaskObject_(sheet, rowNumber, headerMap);
    sheet.getRange(rowNumber, headerMap["封存"]).setValue("是");
    sheet.getRange(rowNumber, headerMap["更新時間"]).setValue(new Date());
    const after = rowToTaskObject_(sheet, rowNumber, headerMap);
    appendLog_(ss, taskId, "封存任務", before, after, user.email || user.name);

    const tasks = listTasks_({ includeArchived: false });
    return { ok: true, tasks, summary: summarizeTasks_(tasks) };
  } finally {
    lock.releaseLock();
  }
}

/** 電子紙看板資料。 */
function getBoardData() {
  const user = assertAuthorized_();
  const settings = getSettings_();
  const allTasks = listTasks_({ includeArchived: false });
  const now = new Date();
  const maxTasks = clampNumber_(settings.BOARD_MAX_TASKS, 1, 12, 6);
  const autoShowDays = clampNumber_(settings.AUTO_SHOW_DAYS, 0, 60, 7);

  const active = allTasks.filter((task) => !isDoneStatus_(task.status));
  const visible = active
    .filter((task) => shouldShowOnBoard_(task, now, autoShowDays))
    .sort(compareTasks_)
    .slice(0, maxTasks);

  const todayCompleted = allTasks.filter((task) => {
    if (!isDoneStatus_(task.status) || !task.completedAt) return false;
    const completed = parseDateTime_(task.completedAt);
    return completed && sameDate_(completed, now);
  }).length;

  const timeline = visible
    .filter(
      (task) =>
        task.dueDate &&
        task.dueTime &&
        sameDate_(parseDateOnly_(task.dueDate), now),
    )
    .sort((a, b) => String(a.dueTime).localeCompare(String(b.dueTime)))
    .slice(0, 3);

  return {
    user,
    title: settings.SYSTEM_NAME || "校務行政每日任務系統",
    office: getActiveOfficeContext_(),
    refreshMinutes: clampNumber_(settings.BOARD_REFRESH_MINUTES, 1, 120, 10),
    tasks: visible,
    timeline,
    summary: {
      urgent: active.filter((task) => task.priority === "高").length,
      waiting: active.filter((task) => isWaitingStatus_(task.status)).length,
      dueToday: active.filter(
        (task) => task.dueDate && sameDate_(parseDateOnly_(task.dueDate), now),
      ).length,
      doneToday: todayCompleted,
      active: active.length,
    },
    serverTime: formatDateTime_(now),
  };
}

/** 安裝型 onEdit 觸發器。 */
function handleTaskEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (
    sheet.getName() !== APP_CONFIG.TASK_SHEET ||
    e.range.getLastRow() < APP_CONFIG.DATA_START_ROW
  )
    return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) return;
  try {
    const headerMap = getHeaderMap_(sheet);
    const now = new Date();
    const firstRow = Math.max(e.range.getRow(), APP_CONFIG.DATA_START_ROW);
    const lastRow = e.range.getLastRow();
    const editedHeader =
      sheet
        .getRange(APP_CONFIG.HEADER_ROW, e.range.getColumn())
        .getDisplayValue() || "多欄位";

    for (let row = firstRow; row <= lastRow; row++) {
      const name = String(
        sheet.getRange(row, headerMap["任務名稱"]).getDisplayValue() || "",
      ).trim();
      if (!name && e.range.getColumn() !== headerMap["任務名稱"]) continue;

      const taskIdCell = sheet.getRange(row, headerMap["任務ID"]);
      if (!taskIdCell.getValue()) taskIdCell.setValue(createTaskId_());

      const createdCell = sheet.getRange(row, headerMap["建立時間"]);
      if (!createdCell.getValue()) createdCell.setValue(now);
      sheet.getRange(row, headerMap["更新時間"]).setValue(now);

      const status = String(
        sheet.getRange(row, headerMap["狀態"]).getDisplayValue(),
      ).trim();
      const completedCell = sheet.getRange(row, headerMap["完成時間"]);
      if (status === "已完成" && !completedCell.getValue())
        completedCell.setValue(now);
      if (status !== "已完成" && completedCell.getValue())
        completedCell.clearContent();

      const displayCell = sheet.getRange(row, headerMap["看板顯示"]);
      if (!displayCell.getValue()) displayCell.setValue("自動");
      const archiveCell = sheet.getRange(row, headerMap["封存"]);
      if (!archiveCell.getValue()) archiveCell.setValue("否");

      applyRowFormats_(sheet, row, headerMap);

      appendLog_(
        sheet.getParent(),
        String(taskIdCell.getDisplayValue()).trim(),
        `試算表編輯：${editedHeader}`,
        e.range.getNumRows() === 1 &&
          e.range.getNumColumns() === 1 &&
          e.oldValue !== undefined
          ? e.oldValue
          : "",
        e.range.getNumRows() === 1 &&
          e.range.getNumColumns() === 1 &&
          e.value !== undefined
          ? e.value
          : "批次編輯",
        getCurrentUser_().email || "試算表使用者",
      );
    }
  } finally {
    lock.releaseLock();
  }
}

/** 顯示部署連結。 */
function showWebAppLinks() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    SpreadsheetApp.getUi().alert(
      "尚未部署 Web App。請在 Apps Script 中選擇「部署 → 新增部署 → 網頁應用程式」。",
    );
    return;
  }

  const html = HtmlService.createHtmlOutput(
    `
    <div style="font-family:Arial,'Microsoft JhengHei',sans-serif;padding:18px;line-height:1.8">
      <h2 style="margin-top:0">校務任務系統</h2>
      <p><a href="${escapeHtmlServer_(url)}" target="_blank">開啟管理台</a></p>
      <p><a href="${escapeHtmlServer_(url)}?page=board" target="_blank">開啟電子紙看板</a></p>
      <p style="color:#666;font-size:13px">電子紙裝置建議使用看板網址並加入首頁捷徑。</p>
    </div>
  `,
  )
    .setWidth(420)
    .setHeight(260);
  SpreadsheetApp.getUi().showModalDialog(html, "開啟系統");
}

/** 系統診斷。 */
function diagnoseSystem() {
  const ss = getSpreadsheet_();
  const messages = [];
  const settings = getSettings_();
  const profile = OFFICE_PROFILES[settings.OFFICE_KEY];
  messages.push(
    profile
      ? `✓ 處室設定：${profile.name}／${settings.ROLE_NAME || "未指定職務"}`
      : "✗ 處室設定無效，請重新執行安裝精靈",
  );
  const taskSheet = ss.getSheetByName(APP_CONFIG.TASK_SHEET);
  messages.push(taskSheet ? "✓ 找到任務清單" : "✗ 缺少任務清單");

  if (taskSheet) {
    const headers = taskSheet
      .getRange(1, 1, 1, Math.max(taskSheet.getLastColumn(), 1))
      .getDisplayValues()[0];
    const missing = TASK_HEADERS.filter((header) => !headers.includes(header));
    messages.push(
      missing.length ? `✗ 缺少欄位：${missing.join("、")}` : "✓ 任務欄位完整",
    );
    messages.push(
      `✓ 任務資料列：${Math.max(taskSheet.getLastRow() - 1, 0)} 筆`,
    );
  }

  [
    APP_CONFIG.LOG_SHEET,
    APP_CONFIG.SETTINGS_SHEET,
    APP_CONFIG.OPTIONS_SHEET,
  ].forEach((name) => {
    messages.push(ss.getSheetByName(name) ? `✓ 找到${name}` : `✗ 缺少${name}`);
  });

  const triggers = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === "handleTaskEdit",
  );
  messages.push(
    triggers.length ? "✓ 已安裝編輯觸發器" : "✗ 尚未安裝編輯觸發器",
  );
  messages.push(
    ScriptApp.getService().getUrl()
      ? "✓ 已有 Web App 部署網址"
      : "△ 尚未建立 Web App 部署",
  );

  return messages;
}

function showDiagnosis() {
  SpreadsheetApp.getUi().alert(
    "系統診斷",
    diagnoseSystem().join("\n"),
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

/** ---------- 安裝與結構 ---------- */

function assertSpreadsheetUiContext_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error("此操作只能從綁定的 Google Sheet 選單執行。");
  }
  return active;
}

function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const installedId = PropertiesService.getScriptProperties().getProperty(
    "BOUND_SPREADSHEET_ID",
  );
  if (installedId) return SpreadsheetApp.openById(installedId);
  throw new Error(
    "找不到已安裝的試算表。請從綁定此專案的 Google Sheet 執行安裝精靈。",
  );
}

function locateOrCreateTaskSheet_(ss) {
  let sheet = ss.getSheetByName(APP_CONFIG.TASK_SHEET);
  if (sheet) return sheet;

  const candidate = ss.getSheets().find((item) => {
    if (item.getLastColumn() === 0) return false;
    const headers = item
      .getRange(1, 1, 1, item.getLastColumn())
      .getDisplayValues()[0]
      .map(String);
    return headers.some((header) =>
      HEADER_ALIASES.任務名稱.includes(header.trim()),
    );
  });

  if (candidate) {
    candidate.setName(APP_CONFIG.TASK_SHEET);
    return candidate;
  }
  return ss.insertSheet(APP_CONFIG.TASK_SHEET, 0);
}

function migrateTaskSheet_(ss, sheet, profile, ownerName, seedSamples) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const existing =
    lastRow > 0 && lastColumn > 0
      ? sheet.getRange(1, 1, lastRow, lastColumn).getValues()
      : [];

  const existingHeaders = existing.length
    ? existing[0].map((value) => String(value).trim())
    : [];
  const alreadyCanonical = TASK_HEADERS.every(
    (header, index) => existingHeaders[index] === header,
  );

  if (alreadyCanonical) {
    if (seedSamples && lastRow < APP_CONFIG.DATA_START_ROW) {
      const demoRows = createDemoRows_(profile, ownerName);
      sheet
        .getRange(2, 1, demoRows.length, TASK_HEADERS.length)
        .setValues(demoRows);
    }
    return;
  }

  let migratedRows = [];
  if (existing.length > 1 && existingHeaders.some(Boolean)) {
    createBackupSheet_(ss, sheet);
    migratedRows = existing
      .slice(1)
      .filter((row) => row.some((value) => value !== "" && value !== null))
      .map((row) => migrateLegacyRow_(existingHeaders, row));
  }

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clear();
  sheet.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);

  if (migratedRows.length) {
    sheet
      .getRange(2, 1, migratedRows.length, TASK_HEADERS.length)
      .setValues(migratedRows);
  } else if (seedSamples) {
    const demoRows = createDemoRows_(profile, ownerName);
    sheet
      .getRange(2, 1, demoRows.length, TASK_HEADERS.length)
      .setValues(demoRows);
  }
}

function createBackupSheet_(ss, sourceSheet) {
  const stamp = Utilities.formatDate(
    new Date(),
    APP_CONFIG.TIMEZONE,
    "yyyyMMdd_HHmmss",
  );
  const baseName = `原始資料備份_${stamp}`;
  let name = baseName;
  let index = 2;
  while (ss.getSheetByName(name)) name = `${baseName}_${index++}`;
  sourceSheet.copyTo(ss).setName(name).hideSheet();
}

function migrateLegacyRow_(headers, row) {
  const record = {};
  headers.forEach(
    (header, index) => (record[String(header).trim()] = row[index]),
  );
  const now = new Date();
  const taskId = getAliasedValue_(record, "任務ID") || createTaskId_();
  const combinedDeadline = getAliasedValue_(record, "截止時間");
  const deadlineParts = splitDeadline_(combinedDeadline);

  const object = {
    taskId,
    name: getAliasedValue_(record, "任務名稱") || "未命名任務",
    category: getAliasedValue_(record, "類型") || "其他",
    status: normalizeStatus_(getAliasedValue_(record, "狀態")),
    priority: normalizePriority_(getAliasedValue_(record, "優先級")),
    dueDate:
      normalizeDateString_(getAliasedValue_(record, "截止日期")) ||
      deadlineParts.date,
    dueTime: normalizeTimeString_(combinedDeadline) || deadlineParts.time,
    nextAction: getAliasedValue_(record, "下一步行動"),
    waitingFor: getAliasedValue_(record, "等待對象"),
    progress: getAliasedValue_(record, "最近進度"),
    owner: getAliasedValue_(record, "負責人"),
    ownerEmail: getAliasedValue_(record, "負責人Email"),
    boardDisplay: normalizeBoardDisplay_(getAliasedValue_(record, "看板顯示")),
    sortOrder: Number(getAliasedValue_(record, "顯示排序")) || 100,
    detailUrl: getAliasedValue_(record, "詳細連結"),
    createdAt: parseDateTime_(getAliasedValue_(record, "建立時間")) || now,
    updatedAt: parseDateTime_(getAliasedValue_(record, "更新時間")) || now,
    completedAt: parseDateTime_(getAliasedValue_(record, "完成時間")) || "",
    archived: normalizeArchived_(getAliasedValue_(record, "封存")),
  };

  const headerMap = {};
  TASK_HEADERS.forEach((header, index) => (headerMap[header] = index + 1));
  return taskObjectToRow_(object, headerMap, TASK_HEADERS.length);
}

function ensureAuxiliarySheets_(ss, optionLists) {
  ensureOptionsSheet_(ss, optionLists || getOptionLists_());
  ensureSettingsSheet_(ss);
  ensureLogSheet_(ss);
}

function ensureOptionsSheet_(ss, optionLists) {
  let sheet = ss.getSheetByName(APP_CONFIG.OPTIONS_SHEET);
  if (!sheet) sheet = ss.insertSheet(APP_CONFIG.OPTIONS_SHEET);

  const lists = optionLists || getOptionLists_();
  const columns = Object.keys(lists);
  const maxLength = Math.max(...columns.map((key) => lists[key].length));
  const values = [columns];
  for (let i = 0; i < maxLength; i++) {
    values.push(columns.map((key) => lists[key][i] || ""));
  }

  sheet.clear();
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  styleHeader_(sheet.getRange(1, 1, 1, columns.length));
  sheet.autoResizeColumns(1, columns.length);
}

function ensureSettingsSheet_(ss) {
  let sheet = ss.getSheetByName(APP_CONFIG.SETTINGS_SHEET);
  if (!sheet) sheet = ss.insertSheet(APP_CONFIG.SETTINGS_SHEET);

  const existing = {};
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 3)
      .getValues()
      .forEach((row) => {
        if (row[0]) existing[String(row[0])] = row;
      });
  }

  const rows = DEFAULT_SETTINGS.map((row) => existing[row[0]] || row);
  sheet.clear();
  sheet.getRange(1, 1, 1, 3).setValues([["設定項目", "設定值", "說明"]]);
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  styleHeader_(sheet.getRange(1, 1, 1, 3));
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 1, 190);
  sheet.setColumnWidths(2, 1, 220);
  sheet.setColumnWidths(3, 1, 360);
}

function ensureLogSheet_(ss) {
  let sheet = ss.getSheetByName(APP_CONFIG.LOG_SHEET);
  if (!sheet) sheet = ss.insertSheet(APP_CONFIG.LOG_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  }
  styleHeader_(sheet.getRange(1, 1, 1, LOG_HEADERS.length));
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, 3, 145);
  sheet.setColumnWidths(4, 2, 360);
  sheet.setColumnWidths(6, 2, 180);
  sheet.getRange("G:G").setNumberFormat("yyyy/mm/dd hh:mm:ss");
}

function applyTaskSheetDesign_(sheet, optionLists) {
  if (sheet.getLastColumn() < TASK_HEADERS.length) {
    sheet.insertColumnsAfter(
      Math.max(sheet.getLastColumn(), 1),
      TASK_HEADERS.length - sheet.getLastColumn(),
    );
  }

  sheet.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
  styleHeader_(sheet.getRange(1, 1, 1, TASK_HEADERS.length));
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  const widths = [
    145, 310, 95, 105, 80, 105, 85, 340, 150, 300, 110, 210, 110, 90, 300, 155,
    155, 155, 75,
  ];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));

  const desiredRows = APP_CONFIG.MAX_ROWS_FOR_VALIDATION + 1;
  if (sheet.getMaxRows() < desiredRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), desiredRows - sheet.getMaxRows());
  }
  const rowCount = sheet.getMaxRows() - 1;
  const optionsSheet = sheet
    .getParent()
    .getSheetByName(APP_CONFIG.OPTIONS_SHEET);
  const optionHeaderMap = getHeaderMap_(optionsSheet);
  const taskHeaderMap = getHeaderMap_(sheet);

  const lists = optionLists || getOptionLists_();
  Object.keys(lists).forEach((header) => {
    if (!taskHeaderMap[header] || !optionHeaderMap[header]) return;
    const optionRange = optionsSheet.getRange(
      2,
      optionHeaderMap[header],
      lists[header].length,
      1,
    );
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(optionRange, true)
      .setAllowInvalid(false)
      .setHelpText(`請從「${header}」清單中選擇。`)
      .build();
    sheet
      .getRange(2, taskHeaderMap[header], rowCount, 1)
      .setDataValidation(rule);
  });

  sheet
    .getRange(2, taskHeaderMap["截止日期"], rowCount, 1)
    .setNumberFormat("yyyy/mm/dd");
  sheet
    .getRange(2, taskHeaderMap["截止時間"], rowCount, 1)
    .setNumberFormat("hh:mm");
  ["建立時間", "更新時間", "完成時間"].forEach((header) => {
    sheet
      .getRange(2, taskHeaderMap[header], rowCount, 1)
      .setNumberFormat("yyyy/mm/dd hh:mm:ss");
  });
  sheet
    .getRange(2, taskHeaderMap["顯示排序"], rowCount, 1)
    .setNumberFormat("0");

  sheet
    .getRange(2, 1, rowCount, TASK_HEADERS.length)
    .setVerticalAlignment("middle")
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  [
    taskHeaderMap["任務名稱"],
    taskHeaderMap["下一步行動"],
    taskHeaderMap["最近進度"],
  ].forEach((column) => sheet.getRange(2, column, rowCount, 1).setWrap(true));

  const statusRange = sheet.getRange(2, taskHeaderMap["狀態"], rowCount, 1);
  const priorityRange = sheet.getRange(2, taskHeaderMap["優先級"], rowCount, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("高")
      .setBackground("#f4cccc")
      .setFontColor("#990000")
      .setRanges([priorityRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("等待他人")
      .setBackground("#fff2cc")
      .setFontColor("#7f6000")
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("已完成")
      .setBackground("#d9ead3")
      .setFontColor("#274e13")
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo("取消")
      .setBackground("#eeeeee")
      .setFontColor("#666666")
      .setRanges([statusRange])
      .build(),
  ];
  sheet.setConditionalFormatRules(rules);

  if (!sheet.getFilter() && sheet.getLastRow() >= 1) {
    sheet
      .getRange(1, 1, sheet.getMaxRows(), TASK_HEADERS.length)
      .createFilter();
  }

  const dataRows = Math.max(sheet.getLastRow() - 1, 0);
  if (dataRows > 0) {
    for (let row = 2; row <= sheet.getLastRow(); row++)
      applyRowFormats_(sheet, row, taskHeaderMap);
  }
}

function applyRowFormats_(sheet, rowNumber, headerMap) {
  sheet
    .getRange(rowNumber, headerMap["截止日期"])
    .setNumberFormat("yyyy/mm/dd");
  sheet.getRange(rowNumber, headerMap["截止時間"]).setNumberFormat("hh:mm");
  ["建立時間", "更新時間", "完成時間"].forEach((header) => {
    sheet
      .getRange(rowNumber, headerMap[header])
      .setNumberFormat("yyyy/mm/dd hh:mm:ss");
  });
}

function styleHeader_(range) {
  range
    .setBackground("#1f4e78")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
}

function ensureInstallableEditTrigger_(ss) {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "handleTaskEdit")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("handleTaskEdit").forSpreadsheet(ss).onEdit().create();
}

/** ---------- 資料讀寫 ---------- */

function listTasks_(options) {
  const includeArchived = Boolean(options && options.includeArchived);
  const ss = getSpreadsheet_();
  const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
  if (sheet.getLastRow() < APP_CONFIG.DATA_START_ROW) return [];

  const headerMap = getHeaderMap_(sheet);
  const values = sheet
    .getRange(
      APP_CONFIG.DATA_START_ROW,
      1,
      sheet.getLastRow() - 1,
      TASK_HEADERS.length,
    )
    .getValues();

  return values
    .map((row, index) =>
      rowArrayToTaskObject_(row, headerMap, index + APP_CONFIG.DATA_START_ROW),
    )
    .filter((task) => task.name)
    .filter((task) => includeArchived || task.archived !== "是")
    .sort(compareTasks_);
}

function rowToTaskObject_(sheet, rowNumber, headerMap) {
  const row = sheet
    .getRange(rowNumber, 1, 1, TASK_HEADERS.length)
    .getValues()[0];
  return rowArrayToTaskObject_(row, headerMap, rowNumber);
}

function rowArrayToTaskObject_(row, headerMap, rowNumber) {
  const get = (header) => row[headerMap[header] - 1];
  return {
    rowNumber,
    taskId: String(get("任務ID") || "").trim(),
    name: String(get("任務名稱") || "").trim(),
    category: String(get("類型") || "").trim(),
    status: String(get("狀態") || "").trim(),
    priority: String(get("優先級") || "").trim(),
    dueDate: formatDateOnly_(get("截止日期")),
    dueTime: formatTimeOnly_(get("截止時間")),
    nextAction: String(get("下一步行動") || "").trim(),
    waitingFor: String(get("等待對象") || "").trim(),
    progress: String(get("最近進度") || "").trim(),
    owner: String(get("負責人") || "").trim(),
    ownerEmail: String(get("負責人Email") || "").trim(),
    boardDisplay: String(get("看板顯示") || "自動").trim(),
    sortOrder: Number(get("顯示排序")) || 9999,
    detailUrl: String(get("詳細連結") || "").trim(),
    createdAt: formatDateTime_(get("建立時間")),
    updatedAt: formatDateTime_(get("更新時間")),
    completedAt: formatDateTime_(get("完成時間")),
    archived: String(get("封存") || "否").trim(),
  };
}

function taskObjectToRow_(task, headerMap, columnCount) {
  const row = Array(columnCount).fill("");
  const set = (header, value) => {
    const column = headerMap[header];
    if (column) row[column - 1] = value;
  };

  set("任務ID", task.taskId || createTaskId_());
  set("任務名稱", task.name || "");
  set("類型", task.category || "其他");
  set("狀態", task.status || "未開始");
  set("優先級", task.priority || "中");
  set("截止日期", task.dueDate ? parseDateOnly_(task.dueDate) : "");
  set("截止時間", task.dueTime ? parseTimeOnly_(task.dueTime) : "");
  set("下一步行動", task.nextAction || "");
  set("等待對象", task.waitingFor || "");
  set("最近進度", task.progress || "");
  set("負責人", task.owner || "");
  set("負責人Email", task.ownerEmail || "");
  set("看板顯示", task.boardDisplay || "自動");
  set("顯示排序", Number(task.sortOrder) || 9999);
  set("詳細連結", task.detailUrl || "");
  set("建立時間", task.createdAt || new Date());
  set("更新時間", task.updatedAt || new Date());
  set("完成時間", task.completedAt || "");
  set("封存", task.archived || "否");
  return row;
}

function getHeaderMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet
    .getRange(APP_CONFIG.HEADER_ROW, 1, 1, lastColumn)
    .getDisplayValues()[0];
  const map = {};
  headers.forEach((header, index) => {
    const key = String(header || "").trim();
    if (key) map[key] = index + 1;
  });
  return map;
}

function findTaskRowById_(sheet, headerMap, taskId) {
  if (!taskId || sheet.getLastRow() < 2) return 0;
  const column = headerMap["任務ID"];
  const match = sheet
    .getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(taskId))
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function appendLog_(ss, taskId, action, before, after, actor) {
  const sheet = getRequiredSheet_(ss, APP_CONFIG.LOG_SHEET);
  const summarize = (value) => {
    if (value === null || value === undefined || value === "") return "";
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 5000 ? `${text.slice(0, 4997)}...` : text;
  };
  sheet.appendRow([
    `LOG-${Utilities.getUuid()}`,
    taskId || "",
    action || "",
    summarize(before),
    summarize(after),
    actor || "unknown",
    new Date(),
  ]);
}

/** ---------- 驗證與安全 ---------- */

function getCurrentUser_() {
  const email = String(Session.getActiveUser().getEmail() || "").trim();
  return {
    email,
    name: email ? email.split("@")[0] : "Workspace 使用者",
  };
}

function assertAuthorized_() {
  const user = getCurrentUser_();
  const settings = getSettings_();
  const allowedDomain = String(settings.ALLOWED_DOMAIN || "")
    .trim()
    .toLowerCase();

  if (allowedDomain) {
    if (!user.email) {
      throw new Error(
        "無法取得登入帳號，請確認 Web App 僅開放給 Workspace 網域使用者。",
      );
    }
    const domain = user.email.split("@")[1] || "";
    if (domain.toLowerCase() !== allowedDomain) {
      throw new Error("此帳號不在允許的 Workspace 網域中。");
    }
  }
  return user;
}

function csrfCacheKey_(token) {
  return `csrfToken:${String(token || "").trim()}`;
}

function issueCsrfToken_() {
  const token = Utilities.getUuid();
  CacheService.getUserCache().put(
    csrfCacheKey_(token),
    "1",
    APP_CONFIG.CSRF_TTL_SECONDS,
  );
  return token;
}

function verifyCsrfToken_(token) {
  const actual = String(token || "").trim();
  if (!actual) {
    throw new Error("操作憑證已失效，請重新整理管理頁。");
  }

  const cache = CacheService.getUserCache();
  const key = csrfCacheKey_(actual);
  if (cache.get(key) !== "1") {
    throw new Error("操作憑證已失效，請重新整理管理頁。");
  }

  // 活躍中的管理頁採滑動期限；閒置超過 6 小時仍會過期，由前端自動換證。
  cache.put(key, "1", APP_CONFIG.CSRF_TTL_SECONDS);
}

function issueInstallToken_() {
  const token = Utilities.getUuid();
  CacheService.getUserCache().put(
    "installCsrfToken",
    token,
    APP_CONFIG.CSRF_TTL_SECONDS,
  );
  return token;
}

function verifyInstallToken_(token) {
  const expected = CacheService.getUserCache().get("installCsrfToken");
  if (!token || !expected || token !== expected) {
    throw new Error("安裝憑證已失效，請關閉視窗後重新開啟安裝精靈。");
  }
}

function normalizePayload_(payload) {
  const settings = getSettings_();
  return {
    taskId: cleanText_(payload.taskId, 80),
    name: cleanText_(payload.name, 200),
    category: cleanText_(payload.category, 50) || "其他",
    status: cleanText_(payload.status, 30) || "未開始",
    priority: cleanText_(payload.priority, 20) || "中",
    dueDate: normalizeDateString_(payload.dueDate),
    dueTime: normalizeTimeString_(payload.dueTime),
    nextAction: cleanText_(payload.nextAction, 1000),
    waitingFor: cleanText_(payload.waitingFor, 200),
    progress: cleanText_(payload.progress, 1000),
    owner: cleanText_(payload.owner, 100) || settings.DEFAULT_OWNER || "",
    ownerEmail:
      cleanText_(payload.ownerEmail, 200) || settings.DEFAULT_OWNER_EMAIL || "",
    boardDisplay: cleanText_(payload.boardDisplay, 30) || "自動",
    sortOrder: Number(payload.sortOrder) || 9999,
    detailUrl: sanitizeUrl_(payload.detailUrl),
    archived: cleanText_(payload.archived, 10) || "否",
  };
}

function validateTaskPayload_(task) {
  const optionLists = getOptionLists_();
  if (!task.name) throw new Error("請填寫任務名稱。");
  if (!optionLists.類型.includes(task.category))
    throw new Error("任務類型不在允許清單中。");
  if (!optionLists.狀態.includes(task.status))
    throw new Error("任務狀態不在允許清單中。");
  if (!optionLists.優先級.includes(task.priority))
    throw new Error("優先級不在允許清單中。");
  if (!optionLists.看板顯示.includes(task.boardDisplay))
    throw new Error("看板顯示設定無效。");
  if (task.ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(task.ownerEmail)) {
    throw new Error("負責人 Email 格式不正確。");
  }
  if (task.sortOrder < 0 || task.sortOrder > 999999)
    throw new Error("顯示排序超出允許範圍。");
}

/** ---------- 看板與統計 ---------- */

function summarizeTasks_(tasks) {
  const now = new Date();
  const active = tasks.filter((task) => !isDoneStatus_(task.status));
  return {
    total: tasks.length,
    active: active.length,
    urgent: active.filter((task) => task.priority === "高").length,
    waiting: active.filter((task) => isWaitingStatus_(task.status)).length,
    dueToday: active.filter(
      (task) => task.dueDate && sameDate_(parseDateOnly_(task.dueDate), now),
    ).length,
    overdue: active.filter((task) => {
      const due = task.dueDate ? parseDateOnly_(task.dueDate) : null;
      return Boolean(due && due < startOfToday_());
    }).length,
    completed: tasks.filter((task) => isDoneStatus_(task.status)).length,
  };
}

function shouldShowOnBoard_(task, now, autoShowDays) {
  if (task.boardDisplay === "隱藏") return false;
  if (task.boardDisplay === "強制顯示") return true;
  if (task.priority === "高" || isWaitingStatus_(task.status)) return true;
  if (!task.dueDate) return task.status === "進行中";

  const due = parseDateOnly_(task.dueDate);
  if (!due) return false;
  const limit = new Date(startOfToday_());
  limit.setDate(limit.getDate() + autoShowDays);
  return due <= limit;
}

function compareTasks_(a, b) {
  const priorityWeight = { 高: 0, 中: 1, 低: 2 };
  const statusWeight = {
    進行中: 0,
    等待他人: 1,
    待確認: 2,
    未開始: 3,
    暫停: 4,
    已完成: 5,
    取消: 6,
  };
  const p =
    (priorityWeight[a.priority] ?? 1) - (priorityWeight[b.priority] ?? 1);
  if (p !== 0) return p;
  const s = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
  if (s !== 0) return s;
  const parsedA = a.dueDate ? parseDateOnly_(a.dueDate) : null;
  const parsedB = b.dueDate ? parseDateOnly_(b.dueDate) : null;
  const dateA = parsedA ? parsedA.getTime() : Number.MAX_SAFE_INTEGER;
  const dateB = parsedB ? parsedB.getTime() : Number.MAX_SAFE_INTEGER;
  if (dateA !== dateB) return dateA - dateB;
  return (Number(a.sortOrder) || 9999) - (Number(b.sortOrder) || 9999);
}

function isDoneStatus_(status) {
  return ["已完成", "取消"].includes(String(status || ""));
}

function isWaitingStatus_(status) {
  return ["等待他人", "待確認"].includes(String(status || ""));
}

/** ---------- 設定與工具 ---------- */

function getOfficeProfile_(officeKey) {
  const key = String(officeKey || "").trim();
  const profile = OFFICE_PROFILES[key];
  if (!profile) throw new Error("無效的處室選擇。");
  return profile;
}

function getOfficeProfileCatalog_() {
  return Object.keys(OFFICE_PROFILES).map((key) => {
    const profile = OFFICE_PROFILES[key];
    return {
      key,
      name: profile.name,
      description: profile.description,
      roles: profile.roles.map((role) => ({ key: role[0], name: role[1] })),
      categories: [...profile.categories],
    };
  });
}

function getActiveOfficeContext_() {
  const settings = getSettings_();
  const key = OFFICE_PROFILES[settings.OFFICE_KEY]
    ? settings.OFFICE_KEY
    : "general_affairs";
  const profile = OFFICE_PROFILES[key];
  const configuredRole = profile.roles.find(
    (role) => role[0] === settings.ROLE_KEY,
  );
  const role = configuredRole || profile.roles[0];
  return {
    key,
    name: profile.name,
    description: profile.description,
    roleKey: role[0],
    roleName: settings.ROLE_NAME || role[1],
    schoolName: settings.SCHOOL_NAME || "",
    profile,
  };
}

function getOptionLists_(profile, taskSheet) {
  const activeProfile = profile || getActiveOfficeContext_().profile;
  const legacyCategories = [];
  let sheet = taskSheet || null;

  if (!sheet) {
    const ss = getSpreadsheet_();
    sheet = ss.getSheetByName(APP_CONFIG.TASK_SHEET);
  }
  if (sheet && sheet.getLastRow() >= APP_CONFIG.DATA_START_ROW) {
    const headerMap = getHeaderMap_(sheet);
    const categoryColumn = headerMap["類型"];
    if (categoryColumn) {
      sheet
        .getRange(
          APP_CONFIG.DATA_START_ROW,
          categoryColumn,
          sheet.getLastRow() - 1,
          1,
        )
        .getDisplayValues()
        .forEach((row) => {
          const value = String(row[0] || "").trim();
          if (value) legacyCategories.push(value);
        });
    }
  }

  return {
    類型: [...new Set([...activeProfile.categories, ...legacyCategories])],
    狀態: [...COMMON_OPTION_LISTS.狀態],
    優先級: [...COMMON_OPTION_LISTS.優先級],
    看板顯示: [...COMMON_OPTION_LISTS.看板顯示],
    封存: [...COMMON_OPTION_LISTS.封存],
  };
}

function applyOfficeProfileSettings_(
  ss,
  officeKey,
  profile,
  roleKey,
  roleName,
  schoolName,
) {
  ensureSettingsSheet_(ss);
  const sheet = getRequiredSheet_(ss, APP_CONFIG.SETTINGS_SHEET);
  const safeSchoolName = cleanText_(schoolName, 100);
  const values = {
    OFFICE_KEY: officeKey,
    OFFICE_NAME: profile.name,
    ROLE_KEY: roleKey,
    ROLE_NAME: roleName,
    SCHOOL_NAME: safeSchoolName,
    SYSTEM_NAME: [
      safeSchoolName,
      profile.name,
      `${roleName}每日任務系統`,
    ].filter(Boolean).join("｜"),
    DEFAULT_OWNER: roleName,
  };
  const keys = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .getDisplayValues()
    .map((row) => String(row[0] || ""));
  Object.keys(values).forEach((key) => {
    const index = keys.indexOf(key);
    if (index >= 0) sheet.getRange(index + 2, 2).setValue(values[key]);
  });
}

function getSettings_() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(APP_CONFIG.SETTINGS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    return Object.fromEntries(DEFAULT_SETTINGS.map((row) => [row[0], row[1]]));
  }

  const result = {};
  sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 2)
    .getDisplayValues()
    .forEach((row) => {
      if (row[0]) result[String(row[0]).trim()] = String(row[1]).trim();
    });
  DEFAULT_SETTINGS.forEach((row) => {
    if (!(row[0] in result)) result[row[0]] = row[1];
  });
  return result;
}

function getRequiredSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet)
    throw new Error(`找不到工作表「${name}」，請先執行 installSystem()。`);
  return sheet;
}

function createTaskId_() {
  const stamp = Utilities.formatDate(
    new Date(),
    APP_CONFIG.TIMEZONE,
    "yyyyMMdd-HHmmss",
  );
  return `SCH-${stamp}-${Utilities.getUuid().slice(0, 6).toUpperCase()}`;
}

function createDemoRows_(profile, ownerName) {
  const now = new Date();
  const today = formatDateOnly_(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = formatDateOnly_(tomorrowDate);
  const activeProfile = profile || OFFICE_PROFILES.general_affairs;
  const dueTimes = ["11:30", "15:00", "16:30"];
  const base = activeProfile.samples.map((sample, index) => ({
    taskId: createTaskId_(),
    name: sample[0],
    category: sample[1],
    status: sample[2],
    priority: sample[3],
    dueDate: index < 2 ? today : tomorrow,
    dueTime: dueTimes[index] || "",
    nextAction: sample[4],
    waitingFor: sample[2] === "等待他人" ? "相關承辦單位" : "",
    progress: "",
    owner: ownerName || activeProfile.roles[0][1],
    ownerEmail: "",
    boardDisplay: index === 0 ? "強制顯示" : "自動",
    sortOrder: (index + 1) * 10,
    detailUrl: "",
    createdAt: now,
    updatedAt: now,
    completedAt: "",
    archived: "否",
  }));

  const map = {};
  TASK_HEADERS.forEach((header, index) => (map[header] = index + 1));
  return base.map((task) => taskObjectToRow_(task, map, TASK_HEADERS.length));
}

function getAliasedValue_(record, canonicalHeader) {
  const aliases = HEADER_ALIASES[canonicalHeader] || [canonicalHeader];
  for (const alias of aliases) {
    if (
      Object.prototype.hasOwnProperty.call(record, alias) &&
      record[alias] !== ""
    )
      return record[alias];
  }
  return "";
}

function normalizeStatus_(value) {
  const text = String(value || "").trim();
  if (!text) return "未開始";
  if (/完成|done|closed/i.test(text)) return "已完成";
  if (/等待|回覆|廠商|他人/.test(text)) return "等待他人";
  if (/確認/.test(text)) return "待確認";
  if (/進行|處理中/.test(text)) return "進行中";
  if (/暫停/.test(text)) return "暫停";
  if (/取消/.test(text)) return "取消";
  return COMMON_OPTION_LISTS.狀態.includes(text) ? text : "未開始";
}

function normalizePriority_(value) {
  const text = String(value || "").trim();
  if (/高|急/.test(text)) return "高";
  if (/低/.test(text)) return "低";
  return "中";
}

function normalizeBoardDisplay_(value) {
  const text = String(value || "").trim();
  if (/隱藏|不顯示|否|false|0/i.test(text)) return "隱藏";
  if (/強制|是|true|1/i.test(text)) return "強制顯示";
  return "自動";
}

function normalizeArchived_(value) {
  return /^(是|true|1)$/i.test(String(value || "").trim()) ? "是" : "否";
}

function splitDeadline_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { date: formatDateOnly_(value), time: formatTimeOnly_(value) };
  }
  const text = String(value || "").trim();
  if (!text) return { date: "", time: "" };
  const match = text.match(
    /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/,
  );
  if (!match) return { date: "", time: normalizeTimeString_(text) };
  return {
    date: `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`,
    time: match[4] ? `${String(match[4]).padStart(2, "0")}:${match[5]}` : "",
  };
}

function normalizeDateString_(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return formatDateOnly_(value);
  const text = String(value).trim();
  const match = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function normalizeTimeString_(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return formatTimeOnly_(value);
  const text = String(value).trim();
  const matches = [...text.matchAll(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?/g)];
  const match = matches.length ? matches[matches.length - 1] : null;
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDateOnly_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      12,
      0,
      0,
    );
  }
  const normalized = normalizeDateString_(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function parseTimeOnly_(value) {
  const normalized = normalizeTimeString_(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return new Date(1899, 11, 30, hour, minute, 0);
}

function parseDateTime_(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value).trim().replace(/\//g, "-");
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly_(value) {
  const date = value instanceof Date ? value : parseDateOnly_(value);
  return date && !Number.isNaN(date.getTime())
    ? Utilities.formatDate(date, APP_CONFIG.TIMEZONE, "yyyy-MM-dd")
    : "";
}

function formatTimeOnly_(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, APP_CONFIG.TIMEZONE, "HH:mm");
  }
  return normalizeTimeString_(value);
}

function formatDateTime_(value) {
  const date = value instanceof Date ? value : parseDateTime_(value);
  return date && !Number.isNaN(date.getTime())
    ? Utilities.formatDate(date, APP_CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss")
    : "";
}

function startOfToday_() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
}

function sameDate_(a, b) {
  return Boolean(
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate(),
  );
}

function cleanText_(value, maxLength) {
  const text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxLength);
}

function sanitizeUrl_(value) {
  const text = cleanText_(value, 1000);
  if (!text) return "";
  if (!/^https:\/\//i.test(text))
    throw new Error("詳細連結只允許 https:// 網址。");
  return text;
}

function clampNumber_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function escapeHtmlServer_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
