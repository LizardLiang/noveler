<div align="center">

# Noveler — AI 小說寫作工具

**AI 互動小說生成器** · 在你的桌面上，與任何大型語言模型（LLM）協作撰寫長篇小說。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js >= 20.19](https://img.shields.io/static/v1?label=node&message=%3E=20.19.0%20||%20%3E=22.12.0&logo=node.js&color=3f893e)](https://nodejs.org/about/releases)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

Noveler 是一款免費、開源的**桌面 AI 寫作工具**，專為長篇小說創作而生。你只要寫下或貼上開場白，再用日常語言下達「作者指令」，一段一段推進劇情——AI 負責產生文字，而你始終是掌鏡的導演。內建的**導演（Director）**會提前規劃劇情節奏，常駐的**世界記憶（World Memory）**會追蹤角色、人物關係與事件，並在生成過程中自動潤飾對白與敘述。

自備模型，自由選擇：可串接 **OpenAI**、**OpenRouter**、任何 **OpenAI 相容**端點，或以本機 **[Ollama](https://ollama.com/)** 完全離線執行。介面為繁體中文，並針對**網文／爽文**風格調校，但底層引擎支援模型所能處理的任何語言。

> 關鍵字：AI 小說生成器 · LLM 創作 · 互動式小說 · 網文/爽文 協作寫作 · Electron 桌面應用程式 · OpenAI / OpenRouter / Ollama · 繁體中文 AI 寫作

![Noveler — AI 小說寫作桌面應用程式](docs/screenshot.png)

## 為什麼選 Noveler

- **你來導演，AI 來執筆。** 每則訊息都會被當成「作者指令」而非成稿，你可以直接掌控語氣、節奏與劇情，不必去改任何提示詞範本。
- **故事始終連貫。** 世界記憶 + 導演讓角色、關係與劇情節奏在數萬字之間保持一致。
- **你的金鑰、你的模型、你的資料。** 一切都在本機的 Electron 應用程式中執行；專案是硬碟上的純檔案，API 金鑰則加密儲存。

## 功能特色

- **回合制故事生成** — 從你選定的模型串流產生故事續寫；輸入框中的內容會被當成作者指令，而非已完成的敘述。
- **世界記憶（World Memory）** — 角色、人物關係與事件依專案常駐儲存，隨故事推進自動更新，也可手動編輯。支援從 JSON 檔案或貼上的文字匯入。
- **導演／劇情規劃** — 維護一份滾動更新的劇情節奏藍圖，並注入場景連貫指令，讓敘事保持一致。
- **整本小說生成** — 描述一個題材與目標字數，讓 Noveler 分段規劃並寫出整份草稿。
- **編輯潤飾流程** — 對白編輯器、敘述編輯器、寫作風格與劇情合規設定，用以雕琢語氣與品質。
- **分支與版本** — 時間軸樹狀圖，可建立／切換／重新命名分支，並支援段落重新生成、版本切換與回溯。
- **多家 AI 供應商** — 任何 OpenAI 相容端點、OpenRouter（顯示額度餘額），以及本機 [Ollama](https://ollama.com/)。也支援 OpenAI / ChatGPT 的 OAuth 裝置流程登入。
- **上下文預算控管** — 以 `js-tiktoken` 計算 token、提供上下文預算指示器，並以故事壓縮（「前情提要」）維持在模型的上下文視窗內。
- **搜尋** — 全文檢索，以及跨專案的角色／事件查詢。
- **自動儲存與當機復原** — 定期快照，重新啟動時提示復原。
- **專案範本**、故事統計、新手引導精靈、深色／淺色／跟隨系統主題，以及可調整的字級。
- **匯入既有小說** — 可將 `.txt` / `.md` 匯入為專案。

## 快速開始

```sh
# 複製專案
git clone https://github.com/LizardLiang/noveler.git
cd noveler

# 安裝相依套件
pnpm install

# 啟動開發環境
pnpm dev
```

需要 Node.js `>= 20.19.0 || >= 22.12.0`。

接著開啟**設定**頁面，新增一個 AI 供應商（OpenAI API 金鑰、OpenRouter、本機 Ollama 網址，或 OAuth 登入），建立專案，即可開始創作。

## 可用指令

- `pnpm dev` — 啟動 Vite 開發伺服器並載入 Electron。
- `pnpm build` — 建置渲染行程並以 electron-builder 打包成應用程式。
- `pnpm release` — 建置並打包但不發佈（`release:win` / `release:mac` / `release:dir` 可指定平台）。
- `pnpm preview` — 於本機預覽正式版建置結果。
- `pnpm test` — 執行 Vitest 單元測試。
- `pnpm test:e2e` — 建置測試模式產物並執行 Playwright 測試。
- `pnpm typecheck` — 執行 TypeScript 型別檢查。

## 技術棧

- **Electron** + **Vite** + **React 19** + **TypeScript**
- **TailwindCSS v4** 樣式
- **Zustand** 管理渲染行程狀態
- **sql.js** 提供各專案的 SQLite 儲存（角色、事件、段落、分支）
- **openai** SDK 處理串流生成；Ollama 與 OAuth/curl 使用原生傳輸
- **zod** 進行結構驗證、**react-router-dom**（hash router）、**react-markdown**

## 專案結構

```tree
├── electron/             主行程與 preload 原始碼
│   ├── main/
│   │   └── services/     AI、世界記憶、導演、編輯器、儲存、OAuth、搜尋…
│   ├── ipc/              IPC 通道處理器
│   ├── preload/
│   └── shared/           主行程與渲染行程共用型別
├── src/                  渲染行程原始碼
│   ├── components/       UI：story、worldMemory、settings、sidebar、search、stats…
│   ├── pages/            ProjectList、Story、Settings
│   ├── stores/           Zustand stores
│   ├── hooks/
│   ├── layouts/
│   └── i18n/             zh-TW 字串
├── build/                打包資源
├── dist-electron/        編譯後的 Electron 輸出
└── test/                 單元測試與端對端測試
    └── e2e/
```

`electron/` 底下的檔案會被編譯到 `dist-electron/`。

## 設定

AI 供應商在應用程式內的**設定**頁面設定——新增 OpenAI 相容的 base URL 與 API 金鑰、連接 OpenRouter、指向本機 Ollama 執行個體，或以 OAuth 登入。API 金鑰會加密儲存於硬碟。寫作風格、對白／敘述編輯、劇情合規與系統提示詞，也都能在設定中調整。

## 參與貢獻

歡迎提交 Issue 與 Pull Request。開 PR 前請先執行 `pnpm typecheck` 與 `pnpm test`。

## 授權

MIT © [LizardLiang](https://github.com/LizardLiang)

<sub>基於 [electron-vite-react](https://github.com/electron-vite/electron-vite-react) 範本建置。</sub>
