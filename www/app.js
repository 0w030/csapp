// 注意：如果在瀏覽器電腦測試，Capacitor 外掛會無法執行，這是正常的，必須在手機上跑。
// 我們可以透過動態載入套件或確保它在 native 環境執行

// 這裡我們直接撰寫處理邏輯，等一下打包進 Android 執行
document.getElementById('start-scan-btn').addEventListener('click', startScan);

async function startScan() {
    // 動態引入 Capacitor 外掛（避免非打包環境噴錯）
    const { BarcodeScanner } = window.Capacitor.Plugins;

    if (!BarcodeScanner) {
        alert('請在 Android 實機上測試掃描功能！');
        return;
    }

    try {
        // 1. 檢查並請求相機權限
        const status = await BarcodeScanner.requestPermissions();
        if (status.camera !== 'granted') {
            alert('必須允許相機權限才能掃描 QR Code');
            return;
        }

        // 2. 準備網頁背景透明化（搭配 CSS）
        document.body.classList.add('barcode-scanner-active');

        // 3. 開始掃描（這會暫時將控制權交給原生鏡頭）
        const result = await BarcodeScanner.startScan();

        // 4. 掃描結束，恢復網頁背景
        document.body.classList.remove('barcode-scanner-active');

        if (result.hasContent) {
            const codeContent = result.content;
            document.getElementById('scan-result').innerText = codeContent;
            
            // 5. 執行內容驗證
            validateContent(codeContent);
        }

    } catch (error) {
        console.error(error);
        document.body.classList.remove('barcode-scanner-active');
        alert('掃描發生錯誤: ' + error.message);
    }
}

// 驗證內容的函式
function validateContent(content) {
    const statusEl = document.getElementById('verify-status');
    
    // 【這裡定義你的初步驗證邏輯】
    // 假設我們規定：正確的 QR Code 內容必須是以 "CSAPP-" 開頭
    if (content.startsWith("CSAPP-")) {
        statusEl.innerText = "驗證成功！這是正確的內容。";
        statusEl.className = "status-success";
    } else {
        statusEl.innerText = "驗證失敗！內容格式不正確。";
        statusEl.className = "status-fail";
    }
}