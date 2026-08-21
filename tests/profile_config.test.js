const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const codePath = path.join(projectRoot, "Code.gs");
const source = fs.readFileSync(codePath, "utf8");
let uuidCounter = 0;
const userCache = new Map();
const context = vm.createContext({
  Utilities: {
    getUuid: () => `test-uuid-${++uuidCounter}`,
  },
  CacheService: {
    getUserCache: () => ({
      put: (key, value) => userCache.set(key, value),
      get: (key) => (userCache.has(key) ? userCache.get(key) : null),
      remove: (key) => userCache.delete(key),
    }),
  },
});

vm.runInContext(
  `${source}
globalThis.__exports = {
  APP_CONFIG,
  TASK_HEADERS,
  COMMON_OPTION_LISTS,
  OFFICE_PROFILES,
  getOfficeProfile_,
  getOfficeProfileCatalog_,
  getOptionLists_,
  csrfCacheKey_,
  issueCsrfToken_,
  verifyCsrfToken_
};`,
  context,
  { filename: "Code.gs" },
);

const {
  APP_CONFIG,
  TASK_HEADERS,
  COMMON_OPTION_LISTS,
  OFFICE_PROFILES,
  getOfficeProfile_,
  getOfficeProfileCatalog_,
  getOptionLists_,
  csrfCacheKey_,
  issueCsrfToken_,
  verifyCsrfToken_,
} = context.__exports;

assert.equal(TASK_HEADERS.length, 19, "任務資料契約必須維持 19 欄");
assert.equal(Object.keys(OFFICE_PROFILES).length, 6, "應提供六個校務處室 profile");

for (const [officeKey, profile] of Object.entries(OFFICE_PROFILES)) {
  assert.match(officeKey, /^[a-z_]+$/, `${officeKey} 應使用穩定英文代碼`);
  assert.ok(profile.name, `${officeKey} 缺少處室名稱`);
  assert.ok(profile.description, `${officeKey} 缺少用途說明`);
  assert.ok(profile.categories.includes("其他"), `${profile.name} 類型必須包含「其他」`);
  assert.equal(
    new Set(profile.categories).size,
    profile.categories.length,
    `${profile.name} 有重複任務類型`,
  );
  assert.ok(profile.roles.length > 0, `${profile.name} 至少需要一個職務`);
  assert.equal(
    new Set(profile.roles.map((role) => role[0])).size,
    profile.roles.length,
    `${profile.name} 有重複職務代碼`,
  );
  for (const sample of profile.samples) {
    assert.equal(sample.length, 5, `${profile.name} 範例任務格式錯誤`);
    assert.ok(profile.categories.includes(sample[1]), `${profile.name} 範例使用無效類型`);
    assert.ok(COMMON_OPTION_LISTS.狀態.includes(sample[2]), `${profile.name} 範例使用無效狀態`);
    assert.ok(COMMON_OPTION_LISTS.優先級.includes(sample[3]), `${profile.name} 範例使用無效優先級`);
  }
}

assert.equal(getOfficeProfile_("academic_affairs").name, "教務處");
assert.throws(() => getOfficeProfile_("not_an_office"), /無效的處室選擇/);

const catalog = getOfficeProfileCatalog_();
assert.equal(catalog.length, 6);
assert.ok(catalog.every((office) => office.roles.every((role) => role.key && role.name)));

const fakeTaskSheet = {
  getLastRow: () => 3,
  getLastColumn: () => TASK_HEADERS.length,
  getRange: (row, column, rowCount, columnCount) => ({
    getDisplayValues: () => {
      if (row === APP_CONFIG.HEADER_ROW) return [Array.from(TASK_HEADERS)];
      assert.equal(column, 3);
      assert.equal(rowCount, 2);
      assert.equal(columnCount, 1);
      return [["舊制自訂類型"], ["課程教學"]];
    },
  }),
};
const options = getOptionLists_(OFFICE_PROFILES.academic_affairs, fakeTaskSheet);
assert.ok(options.類型.includes("舊制自訂類型"), "切換處室時應保留既有任務類型");
assert.equal(options.類型.filter((value) => value === "課程教學").length, 1);

for (const htmlName of ["Installer.html", "Index.html", "Board.html"]) {
  const html = fs.readFileSync(path.join(projectRoot, htmlName), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0, `${htmlName} 缺少前端程式`);
  scripts.forEach((script) => new Function(script));
}

const firstCsrfToken = issueCsrfToken_();
const secondCsrfToken = issueCsrfToken_();
assert.notEqual(firstCsrfToken, secondCsrfToken, "不同管理頁應取得不同 CSRF Token");
assert.equal(userCache.get(csrfCacheKey_(firstCsrfToken)), "1");
assert.equal(userCache.get(csrfCacheKey_(secondCsrfToken)), "1");
assert.doesNotThrow(() => verifyCsrfToken_(firstCsrfToken), "開啟第二分頁後第一分頁憑證仍應有效");
assert.doesNotThrow(() => verifyCsrfToken_(secondCsrfToken), "第二分頁憑證應有效");
userCache.delete(csrfCacheKey_(firstCsrfToken));
assert.throws(() => verifyCsrfToken_(firstCsrfToken), /操作憑證已失效/);
assert.doesNotThrow(() => verifyCsrfToken_(secondCsrfToken), "單一憑證過期不應影響其他管理頁");

const indexSource = fs.readFileSync(path.join(projectRoot, "Index.html"), "utf8");
assert.match(indexSource, /function renewCsrfToken\(\)/, "管理頁應可重新取得 CSRF Token");
assert.match(indexSource, /function withCsrfRetry\(operation\)/, "寫入操作應在憑證過期時自動重試一次");
assert.match(indexSource, /serverCall\('refreshCsrfToken'\)/, "前端應呼叫後端換證端點");
assert.match(indexSource, /CSRF_PROACTIVE_RENEW_MS/, "長時間開啟的管理頁應主動換證");

assert.doesNotMatch(source, /\b1[A-Za-z0-9_-]{30,}\b/, "公開版本不得含固定 Google 資源 ID");
assert.match(source, /BOUND_SPREADSHEET_ID/, "安裝後應以 Script Properties 定位試算表");
assert.match(source, /verifyCsrfToken_/, "寫入流程必須保留 CSRF 驗證");
assert.match(source, /function refreshCsrfToken\(\)/, "後端必須提供安全換證端點");
assert.match(source, /csrfToken:\$\{String\(token/, "每顆 CSRF Token 應使用獨立 cache key");
assert.doesNotMatch(source, /getUserCache\(\)\.put\(\s*"csrfToken"/, "不得用單一固定 cache key 讓多分頁互相覆寫");
assert.match(source, /verifyInstallToken_\(installToken\)/, "安裝寫入必須驗證安裝憑證");
assert.match(source, /assertSpreadsheetUiContext_\(\)/, "安裝端點必須限制在試算表 UI");
assert.match(source, /LockService/, "共享寫入必須保留鎖");

console.log("profile_config.test.js: all checks passed");
