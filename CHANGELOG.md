# Changelog

## v1.2.0 — 2026-09-01

### 新增 Waiting Radar

本版把原本的「等待他人／待確認」從單純狀態提升為可追蹤的行政依賴雷達，讓管理台能回答：目前卡住哪些事、已經等多久、在等誰、何時應該再追，以及哪些等待已經需要主動介入。

### 核心設計

- 新增 `WaitingRadar.gs`，由既有任務與 `工作紀錄` 重建目前這一輪的等待開始時間。
- **維持既有 19 欄任務契約不變**，不需要搬移、重建或重新安裝既有任務資料。
- 第一次按下「已追蹤＋3天」時才建立輔助工作表 `等待追蹤`，保存等待開始、最近追蹤、下次追蹤、追蹤次數與更新時間。
- 一般任務編輯不會重設 Waiting Radar 的等待天數；避免因 `更新時間` 改變而把長期卡住的任務誤判為剛開始等待。
- 重新離開等待狀態後，舊追蹤資料只作歷史保留；下一次重新進入等待時會以新的等待週期計算。

### 管理台

- 新增 Waiting Radar 區塊與四項摘要：等待中、需要介入、今日應追、最長等待。
- 等待項目分為「需介入／今日追蹤／觀察中」。
- 「需介入」包含：追蹤日已過、等待超過 7 天、或未填等待對象。
- 每項等待任務可直接按「已追蹤＋3天」，留下稽核紀錄並排定下一次追蹤。
- 新增「只看等待任務」，快速聚焦所有 `等待他人` 與 `待確認` 任務。

### 安全與相容性

- Waiting Radar 讀取仍經過 `assertAuthorized_()`。
- 「已追蹤」寫入經過 CSRF 驗證與 `LockService`，並追加到既有 `工作紀錄`。
- 不新增 Google OAuth scope、不要求公開試算表。
- DeskPet API v3 與既有 `school-admin-daily-dashboard/v1` 核心任務欄位契約不需變更。

### 部署

同步 `WaitingRadar.gs` 與新版 `Index.html` 到同一 Apps Script 專案後，請將 Dashboard Web App 重新部署為新版本。既有 Google Sheet 19 欄任務清單不需重新安裝；`等待追蹤` 會在第一次記錄追蹤時自動建立。

## v1.1.0 — 2026-08-21

### DeskPet 改為同專案 Gateway 整合

本版新增 `DeskPetGateway.gs`，讓 DeskPet 與校務任務系統共用同一個 Apps Script 專案與同一份 Google Sheet，不再需要另外建立 Gateway Apps Script 專案或手動複製 `DESKPET_SPREADSHEET_ID`。

### 新增內容

- 新增 `DeskPetGateway.gs`。
- 支援 DeskPet API v3：`ping`、`createTask`、`taskDigest`、`updateTask`。
- 直接共用 Dashboard 的 19 欄任務契約、7 欄工作紀錄與既有 helper。
- 新增 `setupDeskPetGateway()`、`showDeskPetApiToken()`、`resetDeskPetApiToken()`、`getDeskPetGatewayStatus()`。
- DeskPet 新增與更新任務時會同步追加 `工作紀錄`。
- `clientTaskId` 轉為穩定 DeskPet 任務 ID，避免重複建立。
- 新增 Gateway contract 測試並納入 `npm test`。

### 部署方式

同一 Apps Script 專案建立兩個不同用途的 Web App deployment：

1. **Dashboard deployment**：維持 Workspace／網域登入。
2. **DeskPet API deployment**：允許 DeskPet 直接 POST，並使用 `DESKPET_API_TOKEN` 驗證。

在建立可公開 POST 的 API deployment 前，請先於 `系統設定` 設定 `ALLOWED_DOMAIN`，避免匿名使用者從公開 deployment 存取管理台資料。

DeskPet 設定中必須填入 **DeskPet API deployment 的 `/exec` URL**，不是 Dashboard 管理台網址。

### 舊版相容

DeskPet repository 內的獨立 `GAS/DeskPet_GAS_API_Gateway_v3.js` 仍可作為 Workspace 政策限制下的備援模式。

## v1.0.1 — 2026-08-21

### 修正管理頁操作憑證失效問題

本次更新主要修正管理頁長時間開啟後，可能出現「操作憑證已失效，請重新整理管理頁」的問題。

### 修正內容

- 修正管理頁開啟超過數小時後，CSRF 操作憑證失效的問題。
- 改為每個管理頁分頁使用獨立憑證，避免開啟第二個分頁時使原分頁失效。
- 使用中的操作憑證會自動延長有效期限。
- 憑證真正失效時，系統會自動取得新憑證並重新執行原操作一次。
- 管理頁每 5 小時主動更新操作憑證。
- 「重新整理」按鈕現在也會同步更新操作憑證。
- 新增多分頁、Token 過期與前端自動換證的回歸測試。

### 更新檔案

正式環境至少需要同步更新：

- `Code.gs`
- `Index.html`

`Board.html`、`Installer.html` 與既有 Google Sheet 19 欄資料結構不需修改或重新安裝。

### DeskPet / 白帥帥

v1.0.1 本身不變更既有獨立 Gateway；若升級到 v1.1.0，可改採同專案 `DeskPetGateway.gs` 整合。

### Apps Script 部署

將新版 `Code.gs` 與 `Index.html` 同步至 Apps Script 後，請重新建立 Web App 版本：

1. 開啟「部署 → 管理部署作業」。
2. 編輯既有 Web App 部署。
3. 選擇「新版本」。
4. 重新部署。

既有 `/exec` 網址可繼續使用。
