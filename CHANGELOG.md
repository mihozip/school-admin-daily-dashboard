# Changelog

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
