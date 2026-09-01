# 校務行政每日任務管理系統（Google Apps Script）

一套以 Google Sheet 為資料底座、Google Apps Script 為服務層的校務任務管理系統。安裝時可選擇處室與職務，系統會套用相對應的任務類型、範例、管理台名稱及直向電子紙看板。

系統目前也內建：

- `WaitingRadar.gs`：把「等待他人／待確認」從靜態狀態提升為可追蹤的行政依賴雷達。
- `DeskPetGateway.gs`：可讓 [DeskPet](https://github.com/mihozip/DeskPet) 直接讀寫同一份任務資料，不必再建立第二個 Apps Script 專案或手動複製 Spreadsheet ID。

## 支援的處室與職務

| 處室 | 可選職務 |
| --- | --- |
| 教務處 | 教務主任、教學組長、註冊組長、設備組長、資訊組長 |
| 學務處 | 學務主任、訓育組長、生教組長、體育組長、衛生組長 |
| 輔導室 | 輔導主任、輔導組長、資料組長、特教組長 |
| 總務處 | 總務主任、事務組長、出納組長、文書組長 |
| 人事室 | 人事主任、人事管理員 |
| 會計室 | 會計主任、會計員 |

各 profile 都有自己的任務類型與 3 筆可選範例。新增處室時，只需在 `Code.gs` 的 `OFFICE_PROFILES` 加入設定，不必複製 CRUD、權限或看板程式。

## 功能

- 安裝精靈選擇學校名稱、處室與主任／組長職務
- 任務新增、編輯、完成、重開與封存
- 狀態、優先級、期限、負責人與下一步行動
- 關鍵字與多條件篩選
- **Waiting Radar：等待中、需要介入、今日應追、最長等待**
- Waiting Radar 分級：**需介入／今日追蹤／觀察中**
- Waiting Radar 快速操作：**已追蹤＋3天、編輯任務、只看等待任務**
- 直向、低動畫、黑白高對比的電子紙看板
- Google Sheet 下拉選單、格式與條件格式
- 工作紀錄稽核、CSRF 驗證、寫入鎖與 Workspace 網域限制
- 舊欄位遷移前自動備份
- 切換處室時保留舊任務與舊任務類型
- DeskPet API v3：`ping`、`createTask`、`taskDigest`、`updateTask`
- DeskPet API Token 建立、顯示、重設與契約診斷

## Waiting Radar

學校行政中，很多工作並不是「還沒做」，而是承辦人已完成自己的部分，正在等待其他人、其他處室、廠商、家長或外部單位回覆。

這類工作若只使用「等待他人」標籤，很容易長期停留在清單中而失去追蹤節點。Waiting Radar 的目的，就是把這些行政依賴轉成可被管理的等待週期。

### Radar 會顯示什麼

每一筆 `等待他人` 或 `待確認` 任務會分析：

- 已等待幾天
- 等待對象
- 下一步行動／最近進度
- 最近一次追蹤時間
- 下一次預定追蹤日期
- 已追蹤次數
- 目前是否需要主動介入

管理台上方會同步顯示四個指標：

- **等待中**：目前所有等待狀態任務數量
- **需要介入**：已出現追蹤風險的任務
- **今日應追**：今天就是預定追蹤日的任務
- **最長等待**：目前等待時間最久的天數

### 判斷分級

Waiting Radar 會將等待任務分成：

- **需介入**：追蹤日期已過、等待達 7 天以上，或尚未填寫等待對象
- **今日追蹤**：今天就是下一次預定追蹤日
- **觀察中**：尚未到追蹤日，且目前沒有明顯卡點

7 天是目前預設的 stale threshold；這個設計是為了提醒管理者重新判斷：「還要繼續等，還是需要換一種處理方式？」

### 「已追蹤＋3天」

在 Radar 中按下 **「已追蹤＋3天」** 後，系統會：

1. 記錄本次追蹤時間。
2. 追蹤次數加 1。
3. 自動把下一次追蹤日排在 3 天後。
4. 將這次操作追加到既有 `工作紀錄`，保留稽核軌跡。

Radar 的追蹤資料不會直接改寫任務本身的 `更新時間`，避免只是「追了一次電話」就讓等待天數被重新計算。

### 等待時間怎麼算

Waiting Radar **不單純使用任務的 `更新時間` 當等待起點**。

原因是任務名稱、期限、最近進度等一般編輯都會改變 `更新時間`。如果直接使用它計算，一件已經等待廠商 18 天的工作，只要補充一次備註，就會看起來像剛開始等待。

因此系統會優先從既有 `工作紀錄` 重建「目前這一輪何時進入等待狀態」；如果是舊資料、無法從歷史紀錄辨識，才退回使用既有任務時間作為估算基準。

當任務離開 `等待他人／待確認`，之後又再次進入等待時，會視為新的等待週期重新計算。

### Waiting Radar 的資料設計

Waiting Radar 採 **附加式設計**，不修改原本 `任務清單` 的 19 欄核心契約。

第一次按下「已追蹤」時，系統才會自動建立輔助工作表：

`等待追蹤`

欄位包括：

1. 任務ID
2. 等待開始
3. 最近追蹤
4. 下次追蹤
5. 追蹤次數
6. 更新時間

這樣可以避免為了 Waiting Radar 強制遷移既有任務資料，也不會破壞 DeskPet API v3 所使用的核心 task contract。

## 檔案

- `Code.gs`：處室 profiles、安裝、遷移、CRUD、權限、稽核、Sheet 與看板 API
- `WaitingRadar.gs`：Waiting Radar 分析、等待週期推導、追蹤狀態與追蹤寫入 API
- `DeskPetGateway.gs`：DeskPet JSON API；直接使用同一 Apps Script 專案綁定的 Spreadsheet
- `Installer.html`：處室／職務安裝精靈
- `Index.html`：任務管理台與 Waiting Radar UI
- `Board.html`：直向電子紙看板
- `appsscript.json`：GAS 時區、V8 與 Web App 設定
- `tests/profile_config.test.js`：處室設定與安全契約檢查
- `tests/deskpet_gateway.test.js`：DeskPet Gateway 契約檢查
- `tests/waiting_radar.test.js`：Waiting Radar、等待週期與 19 欄相容性檢查

## 安裝

1. 建立或開啟一份 Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 將本專案的 `Code.gs`、`WaitingRadar.gs`、`DeskPetGateway.gs`、`Installer.html`、`Index.html`、`Board.html` 與 `appsscript.json` 加入該 Apps Script 專案。
4. 回到試算表重新整理。
5. 選擇「校務任務系統 → 安裝／選擇處室」。
6. 選擇學校、處室、職務，以及是否加入範例任務。
7. 第一次安裝會要求授權。

也可以在 Apps Script 函式選單執行 `installSystem()` 開啟相同的安裝精靈。

安裝完成後會建立：

- `任務清單`
- `工作紀錄`
- `系統設定`
- `選項清單`
- 試算表編輯觸發器

`等待追蹤` 不會在安裝時預先建立；只有第一次使用 Waiting Radar 的「已追蹤」功能時才會自動建立。

若偵測到舊版欄位，系統會先建立隱藏的 `原始資料備份_yyyyMMdd_HHmmss` 工作表，再轉成標準 19 欄資料契約。

### 從 v1.1.x 升級到 v1.2.0

如果既有系統已經完成安裝：

1. 將新增的 `WaitingRadar.gs` 加入原 Apps Script 專案。
2. 更新 `Index.html` 與其他新版程式檔。
3. 將既有 Dashboard Web App 建立「新版本」並重新部署。

**不需要重新執行 `installSystem()`，也不需要遷移既有 19 欄 `任務清單`。**

既有 `/exec` Dashboard URL 可以繼續使用；`等待追蹤` 工作表會在第一次記錄追蹤時自動建立。

## 部署管理台 Web App

管理台仍維持給「人」使用的 Workspace 存取邊界。

1. 在 Apps Script 右上角選擇「部署 → 新增部署」。
2. 類型選擇「網頁應用程式」。
3. 建議使用：
   - 執行身分：部署者
   - 存取權：學校 Workspace 網域內的使用者
4. 部署後可使用：
   - 管理台：`你的管理台部署網址`
   - 電子紙看板：`你的管理台部署網址?page=board`

在 `系統設定` 的 `ALLOWED_DOMAIN` 填入例如 `school.edu.tw`，可再限制登入網域。

Waiting Radar 使用與管理台相同的登入與安全邊界：讀取會經過 `assertAuthorized_()`；「已追蹤」寫入則另外經過 CSRF 驗證、`LockService` 與工作紀錄稽核。

## DeskPet 整合：同專案雙部署

DeskPet 不再需要另外建立一個 Apps Script Gateway 專案。`DeskPetGateway.gs` 與 Dashboard 共用同一個 Apps Script 專案、同一份 Spreadsheet 與同一套 19 欄資料契約。

Waiting Radar 採附加式資料設計，因此 **DeskPet API v3 不需要因 v1.2.0 修改核心 task contract**。DeskPet 原本使用的 `waitingFor`、`status` 與 task digest `waiting` flag 仍可照常運作。

架構：

```text
瀏覽器使用者
   │ Workspace 登入
   ▼
管理台 Deployment（網域限定）
   │
   ├──────────────┐
   ▼              ▼
同一份 Google Sheet   DeskPet API Deployment（直接 POST）
                      ▲
                      │ HTTPS POST + DESKPET_API_TOKEN
                      │
                   DeskPet
```

### 1. 先設定管理台網域

**在建立「任何人」可存取的 DeskPet API Deployment 之前，務必先在 `系統設定` 設定 `ALLOWED_DOMAIN`。**

例如：

```text
ALLOWED_DOMAIN = school.edu.tw
```

原因是同一個 Apps Script 專案仍包含管理台 `doGet()`；公開 API deployment 只應提供 DeskPet 使用，管理台資料操作仍必須由 `assertAuthorized_()` 擋住匿名使用者。

### 2. 建立 Token

在 Apps Script 編輯器的函式選單執行：

```javascript
setupDeskPetGateway()
```

它會：

- 建立或沿用 `DESKPET_API_TOKEN`
- 直接使用本專案綁定的 Spreadsheet，不再需要 `DESKPET_SPREADSHEET_ID`
- 驗證 `任務清單`、`工作紀錄`、`系統設定`、`選項清單`
- 驗證 19 欄任務契約與 7 欄工作紀錄契約
- 回傳目前學校、處室、職務與動態選項

需要查看 Token 時，可執行：

```javascript
showDeskPetApiToken()
```

需要重新產生 Token 時：

```javascript
resetDeskPetApiToken()
```

需要只看狀態、不顯示秘密值時：

```javascript
getDeskPetGatewayStatus()
```

### 3. 建立第二個 Web App Deployment

在**同一個 Apps Script 專案**再新增一個 Web App deployment，專門給 DeskPet：

- 執行身分：部署者
- 存取權：可讓 DeskPet 不經 Google 登入直接 POST 的模式（通常為「任何人」）

這個 deployment 的 `/exec` URL 才是要貼到 DeskPet 的「校務任務系統網址」。

**不要把管理台 deployment URL 貼到 DeskPet。** 管理台 deployment 仍要求 Workspace 登入，DeskPet 的 `URLSession` 會收到登入頁／HTML 而不是 JSON。

### 4. DeskPet 設定

DeskPet 中填入：

```text
網址  = DeskPet API Deployment 的 /exec URL
Token = DESKPET_API_TOKEN
```

按「測試連線」成功後，DeskPet 會取得目前的學校、處室、職務、任務類型、狀態與優先級。

切換 Dashboard 處室後，不需要更換 Token 或重新指定 Spreadsheet；回 DeskPet 再按一次「測試連線」即可刷新 metadata。

## DeskPet API

| Action | 行為 |
| --- | --- |
| `ping` | 驗證 Token 與 Dashboard 契約，回傳 integration metadata |
| `createTask` | 以 `clientTaskId` 冪等建立任務 |
| `taskDigest` | 回傳未封存任務摘要、逾期／今日／高優先／等待旗標 |
| `updateTask` | 更新狀態、期限、下一步行動、等待對象與最近進度 |

API 不接受 Dashboard 的 CSRF Token；機器端授權只使用 `DESKPET_API_TOKEN`。所有 DeskPet 寫入仍會追加到 `工作紀錄`。

## 切換處室

再次開啟「校務任務系統 → 安裝／選擇處室」即可切換。切換時：

- 不刪除或封存既有任務
- 不重新加入範例任務
- 新增任務改用新處室類型
- 舊資料曾使用的類型仍保留，避免既有任務無法編輯
- 管理台、看板、預設負責人與系統名稱改成新處室／職務
- Waiting Radar 仍依既有任務 ID 與工作紀錄持續追蹤，不因切換處室重設
- DeskPet Gateway 不需修改；重新測試連線即可同步新 metadata

## 看板顯示邏輯

- `強制顯示`：一定顯示
- `隱藏`：不顯示
- `自動`：高優先級、等待、進行中，或在 `AUTO_SHOW_DAYS` 天內到期時顯示

Waiting Radar 目前主要呈現在管理台；電子紙看板仍維持低資訊密度的今日工作視圖，不額外寫入資料。

## GitHub 與 clasp

此資料夾不含固定試算表 ID、Token 或學校資料，可直接作為 GitHub repository 的內容。若使用 [clasp](https://github.com/google/clasp)，請把個人的 `.clasp.json` 留在本機；本專案的 `.gitignore` 已排除它。

```bash
npm install -g @google/clasp
clasp login
clasp create --type sheets --title "校務行政每日任務管理系統"
clasp push
```

`clasp create` 產生的 `.clasp.json` 含個人 Script ID，不建議提交公開 repository。

## 本機檢查

```bash
npm test
```

目前會執行：

- `tests/profile_config.test.js`
- `tests/deskpet_gateway.test.js`
- `tests/waiting_radar.test.js`

GitHub Actions 也會在 push 與 pull request 時執行同一組檢查。

## 版本

目前 README 對應 **v1.2.0**。詳細版本變更請參考 [`CHANGELOG.md`](CHANGELOG.md)。

## 授權

[MIT License](LICENSE)
