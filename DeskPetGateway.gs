/**
 * DeskPet API Gateway (integrated companion)
 *
 * This file is intended to live in the SAME Apps Script project as Code.gs.
 * It reuses the dashboard's bound spreadsheet and canonical helpers, so users
 * no longer need to copy Spreadsheet IDs into a second Apps Script project.
 *
 * Security model:
 * - Human dashboard deployment: keep Workspace/domain-only access.
 * - DeskPet API deployment: create a second Web App deployment that allows
 *   direct POST requests, then authenticate every API request with
 *   DESKPET_API_TOKEN.
 * - IMPORTANT: before creating a public API deployment from this same project,
 *   set ALLOWED_DOMAIN in 系統設定. This prevents anonymous users from reading
 *   dashboard data through google.script.run if they open the API deployment.
 */

const DESKPET_GATEWAY_CONFIG = Object.freeze({
  API_VERSION: "3",
  SCHEMA: "school-admin-daily-dashboard/v1",
  TOKEN_PROPERTY: "DESKPET_API_TOKEN",
  TOKEN_BYTES: 32,
  MAX_DIGEST_TASKS: 30,
});

/**
 * Machine API entry point. The human dashboard itself still uses doGet().
 */
function doPost(e) {
  try {
    const bodyText = String(
      e && e.postData && e.postData.contents ? e.postData.contents : "",
    ).trim();
    if (!bodyText) {
      throw deskPetApiError_("EMPTY_BODY", "缺少 JSON request body。");
    }

    let request;
    try {
      request = JSON.parse(bodyText);
    } catch (_) {
      throw deskPetApiError_("INVALID_JSON", "Request body 不是有效 JSON。");
    }

    const version = String(request.apiVersion || "").trim();
    if (!["1", "2", "3"].includes(version)) {
      throw deskPetApiError_(
        "UNSUPPORTED_VERSION",
        `不支援的 DeskPet API 版本：${version || "(empty)"}`,
      );
    }

    deskPetVerifyToken_(request.token);

    switch (String(request.action || "").trim()) {
      case "ping":
        return deskPetJsonResponse_({
          ok: true,
          message: "DeskPet 已連上校務行政每日任務管理系統",
          apiVersion: DESKPET_GATEWAY_CONFIG.API_VERSION,
          integration: deskPetValidateDashboardContract_(),
          serverTime: formatDateTime_(new Date()),
        });

      case "createTask":
        return deskPetJsonResponse_(deskPetCreateTask_(request));

      case "taskDigest":
        return deskPetJsonResponse_(deskPetBuildTaskDigest_(request));

      case "updateTask":
        return deskPetJsonResponse_(deskPetUpdateTask_(request));

      default:
        throw deskPetApiError_(
          "UNKNOWN_ACTION",
          `不支援的 action：${request.action || "(empty)"}`,
        );
    }
  } catch (error) {
    return deskPetJsonResponse_({
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : "INTERNAL_ERROR",
        message:
          error && error.message ? String(error.message) : String(error || "未知錯誤"),
      },
    });
  }
}

/**
 * One-click setup entry point for the Apps Script editor.
 * Uses the dashboard's own BOUND_SPREADSHEET_ID / bound spreadsheet.
 */
function setupDeskPetGateway() {
  const tokenState = createDeskPetApiToken();
  const integration = deskPetValidateDashboardContract_();
  const settings = getSettings_();
  const allowedDomain = String(settings.ALLOWED_DOMAIN || "").trim();

  return {
    ok: true,
    apiVersion: DESKPET_GATEWAY_CONFIG.API_VERSION,
    tokenConfigured: true,
    tokenCreated: tokenState.tokenCreated,
    dashboardContractValid: true,
    sameProjectMode: true,
    allowedDomainConfigured: Boolean(allowedDomain),
    integration,
    warning: allowedDomain
      ? ""
      : "ALLOWED_DOMAIN 尚未設定。若要把同一 Apps Script 專案另部署為『任何人』可存取的 DeskPet API，請先設定學校 Workspace 網域，避免匿名使用者透過公開部署存取管理台資料。",
  };
}

function createDeskPetApiToken() {
  const props = PropertiesService.getScriptProperties();
  let token = String(
    props.getProperty(DESKPET_GATEWAY_CONFIG.TOKEN_PROPERTY) || "",
  ).trim();
  const tokenCreated = !token;

  if (tokenCreated) {
    token = deskPetGenerateToken_();
    props.setProperty(DESKPET_GATEWAY_CONFIG.TOKEN_PROPERTY, token);
  }

  console.info(
    tokenCreated
      ? "DeskPet API Token 已建立。"
      : "DeskPet API Token 已存在，沿用原 Token。",
  );
  console.info(`DESKPET_API_TOKEN = ${token}`);

  return {
    ok: true,
    token,
    tokenConfigured: true,
    tokenCreated,
  };
}

function showDeskPetApiToken() {
  return createDeskPetApiToken();
}

function resetDeskPetApiToken() {
  const token = deskPetGenerateToken_();
  PropertiesService.getScriptProperties().setProperty(
    DESKPET_GATEWAY_CONFIG.TOKEN_PROPERTY,
    token,
  );
  console.info("DeskPet API Token 已重新產生；舊 Token 已失效。");
  console.info(`DESKPET_API_TOKEN = ${token}`);
  return {
    ok: true,
    token,
    tokenConfigured: true,
    tokenRotated: true,
  };
}

function getDeskPetGatewayStatus() {
  const props = PropertiesService.getScriptProperties();
  const settings = getSettings_();
  let integration = null;
  let validationError = "";

  try {
    integration = deskPetValidateDashboardContract_();
  } catch (error) {
    validationError = error && error.message ? String(error.message) : String(error);
  }

  return {
    tokenConfigured: Boolean(
      String(
        props.getProperty(DESKPET_GATEWAY_CONFIG.TOKEN_PROPERTY) || "",
      ).trim(),
    ),
    dashboardContractValid: Boolean(integration),
    sameProjectMode: true,
    allowedDomainConfigured: Boolean(
      String(settings.ALLOWED_DOMAIN || "").trim(),
    ),
    apiVersion: DESKPET_GATEWAY_CONFIG.API_VERSION,
    integration,
    validationError,
  };
}

function deskPetCreateTask_(request) {
  const clientTaskId = cleanText_(request.clientTaskId, 160);
  if (!clientTaskId) {
    throw deskPetApiError_(
      "MISSING_CLIENT_TASK_ID",
      "createTask 必須提供 clientTaskId。",
    );
  }

  const taskId = deskPetTaskIdFromClientId_(clientTaskId);
  const source = cleanText_(request.source, 80) || "deskpet-macos";
  const rawText = cleanText_(request.rawText, 1000);
  const incoming = request.task || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
    const headerMap = getHeaderMap_(sheet);
    deskPetAssertCanonicalHeaders_(sheet, TASK_HEADERS);

    const existingRow = findTaskRowById_(sheet, headerMap, taskId);
    if (existingRow) {
      return {
        ok: true,
        message: "此 DeskPet 任務先前已建立",
        created: false,
        duplicate: true,
        task: deskPetPublicTask_(
          rowToTaskObject_(sheet, existingRow, headerMap),
        ),
        integration: deskPetIntegrationMetadata_(),
      };
    }

    const settings = getSettings_();
    const options = getOptionLists_();
    const now = new Date();
    const category = deskPetAllowedOrFallback_(
      cleanText_(incoming.category, 50),
      options.類型,
      "其他",
    );
    const status = deskPetAllowedOrFallback_(
      cleanText_(incoming.status, 30),
      options.狀態,
      "未開始",
    );
    const priority = deskPetAllowedOrFallback_(
      cleanText_(incoming.priority, 20),
      options.優先級,
      "中",
    );
    const boardDisplay = deskPetAllowedOrFallback_(
      cleanText_(incoming.boardDisplay, 30),
      options.看板顯示,
      "自動",
    );

    const data = {
      taskId,
      name: cleanText_(incoming.name, 200) || rawText || "DeskPet 任務",
      category,
      status,
      priority,
      dueDate: deskPetNormalizeOptionalDate_(incoming.dueDate),
      dueTime: deskPetNormalizeOptionalTime_(incoming.dueTime),
      nextAction: cleanText_(incoming.nextAction, 1000) || rawText,
      waitingFor: cleanText_(incoming.waitingFor, 200),
      progress: cleanText_(incoming.progress, 1000),
      owner:
        cleanText_(incoming.owner, 100) || settings.DEFAULT_OWNER || "",
      ownerEmail:
        cleanText_(incoming.ownerEmail, 200) ||
        settings.DEFAULT_OWNER_EMAIL ||
        "",
      boardDisplay,
      sortOrder: deskPetClampInt_(incoming.sortOrder, 0, 999999, 9999),
      detailUrl: incoming.detailUrl
        ? sanitizeUrl_(incoming.detailUrl)
        : "",
      createdAt: now,
      updatedAt: now,
      completedAt: status === "已完成" ? now : "",
      archived: "否",
    };

    const rowNumber = Math.max(sheet.getLastRow() + 1, APP_CONFIG.DATA_START_ROW);
    const rowValues = taskObjectToRow_(data, headerMap, TASK_HEADERS.length);
    sheet.getRange(rowNumber, 1, 1, TASK_HEADERS.length).setValues([rowValues]);
    applyRowFormats_(sheet, rowNumber, headerMap);

    const after = rowToTaskObject_(sheet, rowNumber, headerMap);
    appendLog_(ss, taskId, "DeskPet 新增任務", "", after, source);
    SpreadsheetApp.flush();

    return {
      ok: true,
      message: "任務已建立",
      created: true,
      duplicate: false,
      task: deskPetPublicTask_(after),
      integration: deskPetIntegrationMetadata_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function deskPetBuildTaskDigest_(request) {
  deskPetValidateDashboardContract_();

  const limit = deskPetClampInt_(
    request.limit,
    1,
    DESKPET_GATEWAY_CONFIG.MAX_DIGEST_TASKS,
    12,
  );
  const allTasks = listTasks_({ includeArchived: false });
  const activeTasks = allTasks.filter((task) => !isDoneStatus_(task.status));
  const summary = summarizeTasks_(allTasks);

  return {
    ok: true,
    summary: {
      active: summary.active,
      dueToday: summary.dueToday,
      overdue: summary.overdue,
      urgent: summary.urgent,
      waiting: summary.waiting,
    },
    tasks: activeTasks.slice(0, limit).map(deskPetDigestTask_),
    integration: deskPetIntegrationMetadata_(),
    serverTime: formatDateTime_(new Date()),
  };
}

function deskPetUpdateTask_(request) {
  const taskId = cleanText_(request.taskId, 120);
  if (!taskId) {
    throw deskPetApiError_("MISSING_TASK_ID", "updateTask 必須提供 taskId。");
  }

  const update = request.update || {};
  const reason = cleanText_(request.reason, 300) || "DeskPet 任務更新";
  const source = cleanText_(request.source, 80) || "deskpet-macos";
  const has = (key) => Object.prototype.hasOwnProperty.call(update, key);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    const sheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
    const headerMap = getHeaderMap_(sheet);
    deskPetAssertCanonicalHeaders_(sheet, TASK_HEADERS);

    const rowNumber = findTaskRowById_(sheet, headerMap, taskId);
    if (!rowNumber) {
      throw deskPetApiError_("TASK_NOT_FOUND", "找不到指定任務。");
    }

    const before = rowToTaskObject_(sheet, rowNumber, headerMap);
    const next = Object.assign({}, before);
    const options = getOptionLists_();

    if (has("status") && update.status !== null) {
      const status = cleanText_(update.status, 30);
      if (!options.狀態.includes(status)) {
        throw deskPetApiError_("INVALID_STATUS", "任務狀態不在允許清單中。");
      }
      next.status = status;
    }

    if (has("dueDate") && update.dueDate !== null) {
      next.dueDate = deskPetNormalizeOptionalDate_(update.dueDate);
    }

    if (has("dueTime") && update.dueTime !== null) {
      next.dueTime = deskPetNormalizeOptionalTime_(update.dueTime);
    }

    if (has("nextAction") && update.nextAction !== null) {
      next.nextAction = cleanText_(update.nextAction, 1000);
    }

    if (has("waitingFor") && update.waitingFor !== null) {
      next.waitingFor = cleanText_(update.waitingFor, 200);
    }

    if (has("progress") && update.progress !== null) {
      next.progress = cleanText_(update.progress, 1000);
    }

    next.updatedAt = new Date();
    if (next.status === "已完成") {
      next.completedAt = before.completedAt || new Date();
    } else if (before.status === "已完成" && next.status !== "已完成") {
      next.completedAt = "";
    }

    const rowValues = taskObjectToRow_(next, headerMap, TASK_HEADERS.length);
    sheet.getRange(rowNumber, 1, 1, TASK_HEADERS.length).setValues([rowValues]);
    applyRowFormats_(sheet, rowNumber, headerMap);

    const after = rowToTaskObject_(sheet, rowNumber, headerMap);
    appendLog_(ss, taskId, `DeskPet 更新任務：${reason}`, before, after, source);
    SpreadsheetApp.flush();

    return {
      ok: true,
      message: "任務已更新",
      task: deskPetPublicTask_(after),
      integration: deskPetIntegrationMetadata_(),
      serverTime: formatDateTime_(new Date()),
    };
  } finally {
    lock.releaseLock();
  }
}

function deskPetValidateDashboardContract_() {
  const ss = getSpreadsheet_();
  const taskSheet = getRequiredSheet_(ss, APP_CONFIG.TASK_SHEET);
  const logSheet = getRequiredSheet_(ss, APP_CONFIG.LOG_SHEET);
  getRequiredSheet_(ss, APP_CONFIG.SETTINGS_SHEET);
  getRequiredSheet_(ss, APP_CONFIG.OPTIONS_SHEET);

  deskPetAssertCanonicalHeaders_(taskSheet, TASK_HEADERS);
  deskPetAssertCanonicalHeaders_(logSheet, LOG_HEADERS);

  return deskPetIntegrationMetadata_();
}

function deskPetIntegrationMetadata_() {
  const settings = getSettings_();
  const options = getOptionLists_();
  return {
    schema: DESKPET_GATEWAY_CONFIG.SCHEMA,
    systemName: settings.SYSTEM_NAME || "校務行政每日任務系統",
    schoolName: settings.SCHOOL_NAME || "",
    officeKey: settings.OFFICE_KEY || "general_affairs",
    officeName: settings.OFFICE_NAME || "總務處",
    roleKey: settings.ROLE_KEY || "director",
    roleName: settings.ROLE_NAME || settings.DEFAULT_OWNER || "",
    categories: options.類型 || [],
    statuses: options.狀態 || [],
    priorities: options.優先級 || [],
    boardDisplayOptions: options.看板顯示 || [],
  };
}

function deskPetAssertCanonicalHeaders_(sheet, expectedHeaders) {
  if (sheet.getLastColumn() < expectedHeaders.length) {
    throw deskPetApiError_(
      "DASHBOARD_SCHEMA_MISMATCH",
      `工作表「${sheet.getName()}」欄位數不足，請先重新執行系統安裝／遷移。`,
    );
  }

  const actual = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0]
    .map((value) => String(value || "").trim());
  const mismatch = expectedHeaders.findIndex(
    (header, index) => actual[index] !== header,
  );
  if (mismatch >= 0) {
    throw deskPetApiError_(
      "DASHBOARD_SCHEMA_MISMATCH",
      `工作表「${sheet.getName()}」第 ${mismatch + 1} 欄應為「${expectedHeaders[mismatch]}」，目前為「${actual[mismatch] || "(空白)"}」。`,
    );
  }
}

function deskPetDigestTask_(task) {
  const due = task.dueDate ? parseDateOnly_(task.dueDate) : null;
  const today = startOfToday_();
  const flags = [];
  if (due && due < today) flags.push("overdue");
  if (due && sameDate_(due, today)) flags.push("dueToday");
  if (task.priority === "高") flags.push("urgent");
  if (isWaitingStatus_(task.status)) flags.push("waiting");

  const result = deskPetPublicTask_(task);
  result.flags = flags;
  return result;
}

function deskPetPublicTask_(task) {
  return {
    taskId: task.taskId || "",
    name: task.name || "",
    category: task.category || "",
    status: task.status || "",
    priority: task.priority || "",
    dueDate: task.dueDate || "",
    dueTime: task.dueTime || "",
    nextAction: task.nextAction || "",
    waitingFor: task.waitingFor || "",
    progress: task.progress || "",
    detailUrl: task.detailUrl || "",
    createdAt: task.createdAt || "",
    updatedAt: task.updatedAt || "",
  };
}

function deskPetAllowedOrFallback_(value, allowed, preferredFallback) {
  const list = Array.isArray(allowed) ? allowed : [];
  if (value && list.includes(value)) return value;
  if (preferredFallback && list.includes(preferredFallback)) {
    return preferredFallback;
  }
  return list.length ? list[0] : preferredFallback || "";
}

function deskPetNormalizeOptionalDate_(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return "";
  const normalized = normalizeDateString_(raw);
  if (!normalized) {
    throw deskPetApiError_("INVALID_DUE_DATE", "截止日期格式必須為 yyyy-MM-dd。");
  }
  return normalized;
}

function deskPetNormalizeOptionalTime_(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return "";
  const normalized = normalizeTimeString_(raw);
  if (!normalized) {
    throw deskPetApiError_("INVALID_DUE_TIME", "截止時間格式必須為 HH:mm。");
  }
  return normalized;
}

function deskPetTaskIdFromClientId_(clientTaskId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(clientTaskId),
    Utilities.Charset.UTF_8,
  );
  const hex = digest
    .map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24)
    .toUpperCase();
  return `DP-${hex}`;
}

function deskPetGenerateToken_() {
  const material = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    String(Date.now()),
    Session.getTemporaryActiveUserKey() || "",
  ].join(":");
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    material,
    Utilities.Charset.UTF_8,
  );
  return digest
    .map((byte) => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"))
    .join("");
}

function deskPetVerifyToken_(candidate) {
  const expected = String(
    PropertiesService.getScriptProperties().getProperty(
      DESKPET_GATEWAY_CONFIG.TOKEN_PROPERTY,
    ) || "",
  ).trim();
  const actual = String(candidate || "").trim();

  if (!expected) {
    throw deskPetApiError_(
      "TOKEN_NOT_CONFIGURED",
      "尚未建立 DeskPet API Token，請先執行 setupDeskPetGateway()。",
    );
  }
  if (!actual || !deskPetConstantTimeEquals_(expected, actual)) {
    throw deskPetApiError_("INVALID_TOKEN", "DeskPet API Token 不正確。");
  }
}

function deskPetConstantTimeEquals_(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function deskPetClampInt_(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function deskPetApiError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function deskPetJsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
