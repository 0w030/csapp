
const scanButton = document.getElementById('start-scan-btn');
const scanResultEl = document.getElementById('scan-result');
const verifyStatusEl = document.getElementById('verify-status');
const scanModeText = document.getElementById('scan-mode-text');
const appContainer = document.getElementById('app-container');
const videoElement = document.getElementById('qr-video');
const canvasElement = document.getElementById('qr-canvas');

let scanStream = null;
let scanInterval = null;
let webBarcodeDetector = null;

scanButton.addEventListener('click', startScan);

async function startScan() {
    resetStatus();
    scanButton.disabled = true;

    const nativeScanner = getNativeScanner();
    const nativeAvailable = nativeScanner && isNativeCapacitor();
    const webAvailable = await isWebBarcodeScannerSupported();

    if (nativeAvailable) {
        scanModeText.innerText = '目前掃描模式：原生 Capacitor 掃描';
        await startNativeScan(nativeScanner);
    } else if (webAvailable) {
        scanModeText.innerText = '目前掃描模式：瀏覽器 QR 掃描';
        await startWebScan();
    } else {
        alert('此裝置/瀏覽器無法使用掃描功能。\n請從 Android 原生 App 或支援 BarcodeDetector 的瀏覽器上開啟。');
    }

    scanButton.disabled = false;
}

function getNativeScanner() {
    return window.Capacitor?.Plugins?.BarcodeScanner ?? null;
}

function isNativeCapacitor() {
    if (typeof window.Capacitor?.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
    }
    return !!window.Capacitor && window.Capacitor.platform !== 'web';
}

async function isWebBarcodeScannerSupported() {
    if (!('BarcodeDetector' in window)) {
        return false;
    }

    try {
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
            const formats = await BarcodeDetector.getSupportedFormats();
            return formats.includes('qr_code');
        }
        return true;
    } catch (error) {
        console.warn('BarcodeDetector 支援查詢失敗：', error);
        return false;
    }
}

async function startNativeScan(BarcodeScanner) {
    try {
        const permissionStatus = await BarcodeScanner.requestPermissions();
        if (permissionStatus.camera !== 'granted') {
            alert('必須允許相機權限才能掃描 QR Code');
            return;
        }

        prepareScannerUi();
        const result = await BarcodeScanner.startScan();
        restoreUi();

        if (result?.hasContent) {
            scanResultEl.innerText = result.content;
            verifyStatusEl.innerText = '掃描完成';
            verifyStatusEl.className = 'status-success';
        } else {
            scanResultEl.innerText = '未取得掃描內容。';
            verifyStatusEl.innerText = '掃描失敗';
            verifyStatusEl.className = 'status-error';
        }
    } catch (error) {
        restoreUi();
        console.error(error);
        alert('掃描發生錯誤：' + (error?.message || error));
        verifyStatusEl.innerText = '掃描錯誤';
        verifyStatusEl.className = 'status-error';
    }
}

async function startWebScan() {
    try {
        webBarcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = scanStream;
        videoElement.hidden = false;
        await videoElement.play();

        prepareScannerUi();
        verifyStatusEl.innerText = '正在進行 Web QR 掃描...';
        verifyStatusEl.className = 'status-waiting';

        scanInterval = window.setInterval(async () => {
            if (videoElement.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) {
                return;
            }

            try {
                const results = await webBarcodeDetector.detect(videoElement);
                if (results.length > 0) {
                    const qr = results[0];
                    stopWebScan();
                    scanResultEl.innerText = qr.rawValue || '未取得掃描內容。';
                    verifyStatusEl.innerText = '掃描完成';
                    verifyStatusEl.className = 'status-success';
                }
            } catch (error) {
                console.error('Web 掃描偵測錯誤：', error);
            }
        }, 300);
    } catch (error) {
        stopWebScan();
        console.error(error);
        alert('無法啟動 Web 相機掃描：' + (error?.message || error));
        verifyStatusEl.innerText = '掃描錯誤';
        verifyStatusEl.className = 'status-error';
    }
}

function stopWebScan() {
    if (scanInterval) {
        window.clearInterval(scanInterval);
        scanInterval = null;
    }
    if (scanStream) {
        scanStream.getTracks().forEach(track => track.stop());
        scanStream = null;
    }
    if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement.hidden = true;
    }
    restoreUi();
}

function prepareScannerUi() {
    document.body.classList.add('barcode-scanner-active');
    document.body.style.backgroundColor = 'transparent';
    appContainer.style.display = 'none';
}

function restoreUi() {
    document.body.classList.remove('barcode-scanner-active');
    document.body.style.backgroundColor = '';
    appContainer.style.display = 'block';
}

function resetStatus() {
    scanResultEl.innerText = '尚未掃描';
    verifyStatusEl.innerText = '等待掃描中...';
    verifyStatusEl.className = 'status-waiting';
    scanModeText.innerText = '目前掃描模式：等待判斷';
}

// ==========================================
// 語音辨識/錄音功能擴充 (完全獨立，不影響原本掃描)
// ==========================================

// 1. 初始化語音 DOM 元素 (請確保 HTML 有對應的 ID)
const voiceButton = document.getElementById('start-voice-btn');
const voiceResultEl = document.getElementById('voice-result');
const voiceStatusEl = document.getElementById('voice-status');

let voiceMediaRecorder = null;
let voiceAudioChunks = [];

// 2. 綁定語音按鈕點擊事件 (切換錄音狀態)
if (voiceButton) {
    voiceButton.addEventListener('click', toggleVoiceRecording);
}

async function toggleVoiceRecording() {
    if (!voiceMediaRecorder || voiceMediaRecorder.state === 'inactive') {
        await startVoiceRecording();
    } else {
        stopVoiceRecording();
    }
}

// 3. 開始錄音
async function startVoiceRecording() {
    voiceAudioChunks = []; // 清空之前的音檔暫存
    
    try {
        // 請求 Android/瀏覽器 的麥克風錄音權限
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        voiceMediaRecorder = new MediaRecorder(stream);
        
        voiceMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                voiceAudioChunks.push(event.data);
            }
        };

        // 當錄音真正結束時，打包成 Blob 並送往 Mock 後台處理
        voiceMediaRecorder.onstop = () => {
            const audioBlob = new Blob(voiceAudioChunks, { type: 'audio/webm' });
            
            if (voiceStatusEl) {
                voiceStatusEl.innerText = "狀態：錄音完成，正在發送音檔至後台...";
            }
            
            // 觸發模擬後台
            handleVoiceUploadMock(audioBlob);
        };

        voiceMediaRecorder.start();
        
        // 更新 UI 狀態
        if (voiceStatusEl) voiceStatusEl.innerText = "狀態：正在聆聽中，請說話...";
        if (voiceButton) {
            voiceButton.innerText = "停止錄音並解析";
            voiceButton.style.backgroundColor = "red";
        }

    } catch (error) {
        console.error("麥克風啟動失敗:", error);
        alert("無法啟動麥克風，請檢查 Android 的 RECORD_AUDIO 權限是否開啟。");
    }
}

// 4. 停止錄音
function stopVoiceRecording() {
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        voiceMediaRecorder.stop();
        
        // 關閉軌道釋放麥克風硬體資源
        voiceMediaRecorder.stream.getTracks().forEach(track => track.stop());
        
        // 恢復按鈕 UI
        if (voiceButton) {
            voiceButton.innerText = "開始語意輸入";
            voiceButton.style.backgroundColor = ""; // 恢復 CSS 預設顏色
        }
    }
}

// 5. 模擬商用 API (Google STT / Whisper) 回傳
function handleVoiceUploadMock(blob) {
    console.log("【前端音檔錄製成功】大小為：", blob.size, "bytes");
    
    // 模擬後端 API 的 1.5 秒網路延遲
    setTimeout(() => {
        // 【核心需求 1】保證高準確度文字，先用 mock 資料做介面驗證
        const mockSpeechToTextResult = "幫我把A05倉庫的感冒藥提出十箱送到診間";
        
        if (voiceResultEl) {
            voiceResultEl.innerText = mockSpeechToTextResult;
        }
        if (voiceStatusEl) {
            voiceStatusEl.innerText = "狀態：語音辨識完成！";
        }
        
        // 進入下一步的意圖拆解（未來會在 FastAPI 透過 LLM 做結構化拆解）
        parseIntentAndDispatchMock(mockSpeechToTextResult);
        
    }, 1500);
}

// 6. 模擬自然語言意圖拆解與指令執行
function parseIntentAndDispatchMock(text) {
    // 這裡先寫一個簡單的文字比對邏輯，方便你在手機上驗證「文字轉指令」的連鎖反應
    if (text.includes("倉庫") && text.includes("送")) {
        console.log("【發送結構化指令至後台執行成功】", {
            intent: "TRANSFER_MATERIAL",
            parameters: {
                raw_text: text,
                parsed_at: new Date().toISOString()
            }
        });
    }
}
