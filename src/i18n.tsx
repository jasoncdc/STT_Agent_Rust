import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Language = "zh" | "en";

// 共用翻譯資料
export const translations = {
  zh: {
    // App Menu
    file: "檔案",
    edit: "編輯",
    recentFiles: "最近開啟的檔案",
    noRecentFiles: "無最近檔案",
    clearRecent: "清除紀錄",
    setProjectPath: "設定專案路徑",
    uninstall: "解除安裝",
    exit: "結束",
    about: "關於",
    updateVersion: "🔄 更新版本",
    newVersionFound: "發現新版本",
    updating: "正在更新...",
    font: "字體",
    zoomIn: "放大",
    zoomOut: "縮小",
    resetZoom: "重設大小",
    appearance: "外觀",
    darkMode: "深色模式",
    lightMode: "淺色模式",
    language: "語言",
    chinese: "中文",
    english: "English",
    // Sidebar
    appTitle: "會議轉錄助理",
    convert: "轉檔",
    split: "切割",
    silence: "消音",
    report: "報告",
    // About Dialog
    aboutTitle: "關於 會議轉錄助理",
    version: "版本",
    description: "一個用於會議錄音轉錄、切割與處理的桌面應用程式。",
    developer: "開發者",
    close: "關閉",
    // Common
    error: "錯誤",
    loading: "載入中...",
    processing: "執行中...",
    selectFolder: "選擇資料夾",
    selectFile: "選擇檔案",
    clear: "清除",
    // ConvertPage
    convertTitle: "轉檔模組",
    convertDescription: "將影音檔案轉換為 MP3 格式",
    selectFiles: "選擇檔案",
    startConvert: "開始轉檔",
    converting: "轉檔中...",
    selectedFiles: "已選擇的檔案",
    filesSelected: "已選擇 {count} 個檔案",
    selectFileError: "選擇檔案錯誤",
    pleaseSelectFile: "請先選擇檔案！",
    // SplitPage
    splitTitle: "切割模組",
    splitDescription: "將長錄音切分成小片段，方便後續處理。",
    audioPlayer: "音訊播放器",
    loadAudio: "載入音訊",
    play: "播放",
    pause: "暫停",
    segmentList: "段落列表",
    addSegment: "新增段落",
    segmentName: "段落名稱",
    startTime: "開始時間",
    endTime: "結束時間",
    action: "操作",
    exampleName: "例如：個案1",
    runSplit: "執行切割",
    splitting: "執行中...",
    deleteSegment: "刪除段落",
    needAtLeastOneSegment: "至少需要一個段落",
    errorLoadAudio: "請先載入音訊檔案",
    errorSetSegment: "請至少設定一個完整的段落（名稱、開始時間、結束時間）",
    loaded: "已載入",
    // SilencePage
    silenceTitle: "消音處理",
    silenceDescription: "針對敏感片段做消音處理",
    silenceAudioPlayer: "音訊播放器", // New Key
    selectAudioFolder: "選擇資料夾", // New Key
    changeFolder: "更改資料夾", // New Key
    runDetection: "執行消音處理",
    detecting: "處理中...",
    segmentNote: "段落備註 (選填)", // New Key
    // ReportPage
    reportTitle: "報告生成",
    reportDescription: "使用 Gemini AI 分析音檔並產出逐字稿報告。",
    audioFolder: "音檔資料夾",
    selectFolderPlaceholder: "請選擇資料夾...",
    apiKeyLabel: "Google Gemini API Key",
    apiKeyPlaceholder: "輸入您的 API Key",
    show: "顯示",
    hide: "隱藏",
    customPrompt: "自定義 Prompt (選填，.txt)",
    customPromptPlaceholder: "預設使用內建 Prompt，可選 .txt 覆蓋...",
    selectPrompt: "選擇 Prompt",
    generateReport: "生成報告 (自動產出 Word 檔)",
    generating: "生成中...",
    manualTools: "手動工具：轉換 markdown 為 Word 文件",
    selectReportFile: "選擇報告檔案 (.md)",
    selectReportPlaceholder: "請選擇 report.md 檔案...",
    convertToDocx: "轉換為 DOCX",
    convertingDocx: "轉換中...",
    errorApiKey: "請先輸入 Gemini API Key",
    errorSelectFolder: "請先選擇音檔資料夾",
    errorSelectReport: "請先選擇報告檔案",
    processingReport: "正在處理音檔並生成報告，這可能需要幾分鐘...",
    convertingToDocx: "正在轉換為 DOCX...",
    selectModel: "選擇模型 (Model)",
    defaultSuffix: "(預設)",
    viewPrompt: "查看 Prompt 範例",
    defaultPromptTitle: "預設 Prompt 內容",
  },
  en: {
    // App Menu
    file: "File",
    edit: "Edit",
    recentFiles: "Recent Files",
    noRecentFiles: "No recent files",
    clearRecent: "Clear History",
    setProjectPath: "Set Project Path",
    uninstall: "Uninstall",
    exit: "Exit",
    about: "About",
    updateVersion: "🔄 Update Available",
    newVersionFound: "New Version Found",
    updating: "Updating...",
    font: "Font",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    resetZoom: "Reset Size",
    appearance: "Appearance",
    darkMode: "Dark Mode",
    lightMode: "Light Mode",
    language: "Language",
    chinese: "中文",
    english: "English",
    // Sidebar
    appTitle: "STT Assistant",
    convert: "Convert",
    split: "Split",
    silence: "Silence",
    report: "Report",
    // About Dialog
    aboutTitle: "About Meeting Transcription Assistant",
    version: "Version",
    description: "A desktop application for meeting recording transcription, splitting, and processing.",
    developer: "Developer",
    close: "Close",
    // Common
    error: "Error",
    loading: "Loading...",
    processing: "Processing...",
    selectFolder: "Select Folder",
    selectFile: "Select File",
    clear: "Clear",
    // ConvertPage
    convertTitle: "Convert Module",
    convertDescription: "Convert audio/video files to MP3 format",
    selectFiles: "Select Files",
    startConvert: "Start Convert",
    converting: "Converting...",
    selectedFiles: "Selected Files",
    filesSelected: "{count} file(s) selected",
    selectFileError: "File selection error",
    pleaseSelectFile: "Please select files first!",
    // SplitPage
    splitTitle: "Split Module",
    splitDescription: "Split long recordings into smaller segments for easier processing.",
    audioPlayer: "Audio Player",
    loadAudio: "Load Audio",
    play: "Play",
    pause: "Pause",
    segmentList: "Segment List",
    addSegment: "Add Segment",
    segmentName: "Segment Name",
    startTime: "Start Time",
    endTime: "End Time",
    action: "Action",
    exampleName: "e.g., Case 1",
    runSplit: "Run Split",
    splitting: "Processing...",
    deleteSegment: "Delete Segment",
    needAtLeastOneSegment: "At least one segment required",
    errorLoadAudio: "Please load an audio file first",
    errorSetSegment: "Please set at least one complete segment (name, start time, end time)",
    loaded: "Loaded",
    // SilencePage
    silenceTitle: "Silence Detection",
    silenceDescription: "Analyze and process silent sections in audio files.",
    silenceAudioPlayer: "Audio Player",
    selectAudioFolder: "Select Folder",
    changeFolder: "Change Folder",
    runDetection: "Run Silence Processor",
    detecting: "Processing...",
    segmentNote: "Segment Note (Optional)",
    // ReportPage
    reportTitle: "Report Generation",
    reportDescription: "Use Gemini AI to analyze audio files and generate transcript reports.",
    audioFolder: "Audio Folder",
    selectFolderPlaceholder: "Please select a folder...",
    apiKeyLabel: "Google Gemini API Key",
    apiKeyPlaceholder: "Enter your API Key",
    show: "Show",
    hide: "Hide",
    customPrompt: "Custom Prompt (optional, .txt)",
    customPromptPlaceholder: "Uses default prompt, select .txt to override...",
    selectPrompt: "Select Prompt",
    generateReport: "Generate Report (auto-creates Word file)",
    generating: "Generating...",
    manualTools: "Manual Tool: Convert markdown to Word document",
    selectReportFile: "Select Report File (.md)",
    selectReportPlaceholder: "Please select report.md file...",
    convertToDocx: "Convert to DOCX",
    convertingDocx: "Converting...",
    errorApiKey: "Please enter Gemini API Key first",
    errorSelectFolder: "Please select an audio folder first",
    errorSelectReport: "Please select a report file first",
    processingReport: "Processing audio and generating report, this may take a few minutes...",
    convertingToDocx: "Converting to DOCX...",
    selectModel: "Select Model",
    defaultSuffix: "(Default)",
    viewPrompt: "View Prompt Example",
    defaultPromptTitle: "Default Prompt Content",
  },
};

export type TranslationKey = keyof typeof translations.zh;

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations.zh;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("app-language");
    return saved === "en" ? "en" : "zh";
  });

  useEffect(() => {
    localStorage.setItem("app-language", language);
  }, [language]);

  const t = translations[language];

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
