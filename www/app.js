
const scanButton = document.getElementById('start-scan-btn');
const scanResultEl = document.getElementById('scan-result');
const verifyStatusEl = document.getElementById('verify-status');
const scanModeText = document.getElementById('scan-mode-text');
const deviceUuidEl = document.getElementById('device-uuid');
const appContainer = document.getElementById('app-container');
const videoElement = document.getElementById('qr-video');
const canvasElement = document.getElementById('qr-canvas');

let scanStream = null;
let scanInterval = null;
let webBarcodeDetector = null;
let deviceUuid = null;

scanButton.addEventListener('click', startScan);

deviceUuid = getOrCreateDeviceUuid();
updateDeviceUuidDisplay();

async function startScan() {
    resetStatus();
    scanButton.disabled = true;

    const nativeScanner = getNativeScanner();
    const nativeAvailable = nativeScanner && isNativeCapacitor();
    console.log('startScan: nativeAvailable=', nativeAvailable, 'nativeScanner=', nativeScanner, 'isNativePlatform=', isNativeCapacitor());
    const webAvailable = await isWebBarcodeScannerSupported();
    console.log('startScan: webAvailable=', webAvailable);

    if (nativeAvailable) {
        scanModeText.innerText = '目前掃描模式：原生 Capacitor 掃描';
        if (typeof nativeScanner.scan === 'function') {
            await startNativeScanBuiltIn(nativeScanner);
        } else {
            await startNativeScan(nativeScanner);
        }
    } else if (webAvailable) {
        scanModeText.innerText = '目前掃描模式：瀏覽器 QR 掃描';
        await startWebScan();
    } else {
        alert('此裝置/瀏覽器無法使用掃描功能。\n請從 Android 原生 App 或支援 BarcodeDetector 的瀏覽器上開啟。');
    }

    scanButton.disabled = false;
}

function getNativeScanner() {
    return window.Capacitor?.Plugins?.BarcodeScanner
        || window.Capacitor?.Plugins?.BarcodeScanning
        || null;
}

function isNativeCapacitor() {
    if (typeof window.Capacitor?.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
    }
    return !!window.Capacitor && window.Capacitor.platform !== 'web';
}

function isScanCancellationError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('canceled') || message.includes('cancelled') || message.includes('cancel');
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
    let barcodeListener = null;
    try {
        console.log('startNativeScan: BarcodeScanner=', BarcodeScanner);
        if (typeof BarcodeScanner.requestPermissions !== 'function') {
            throw new Error('BarcodeScanner plugin 無法取得 requestPermissions 函式。');
        }

        const permissionStatus = await BarcodeScanner.requestPermissions();
        console.log('camera permissionStatus=', permissionStatus);
        if (permissionStatus.camera !== 'granted') {
            const detail = permissionStatus.camera === 'denied'
                ? '請前往裝置設定允許相機權限，或重新安裝 App 後重新授權。'
                : '請確認是否已授權相機存取。';
            alert('必須允許相機權限才能掃描 QR Code。\n' + detail);
            if (typeof BarcodeScanner.openSettings === 'function') {
                try {
                    await BarcodeScanner.openSettings();
                } catch (settingsError) {
                    console.warn('開啟設定失敗：', settingsError);
                }
            }
            return;
        }

        prepareScannerUi();
        verifyStatusEl.innerText = '啟動原生相機掃描中...';
        verifyStatusEl.className = 'status-waiting';

        barcodeListener = await BarcodeScanner.addListener('barcodeScanned', async event => {
            console.log('barcodeScanned event=', event);
            const content = event?.barcode?.rawValue || event?.barcode?.displayValue;
            if (!content) {
                return;
            }

            scanResultEl.innerText = content;
            verifyStatusEl.innerText = '掃描完成';
            verifyStatusEl.className = 'status-success';
            logScanPackage(content);

            if (barcodeListener && typeof barcodeListener.remove === 'function') {
                await barcodeListener.remove();
                barcodeListener = null;
            }
            try {
                if (typeof BarcodeScanner.stopScan === 'function') {
                    await BarcodeScanner.stopScan();
                }
            } catch (stopError) {
                console.warn('停止原生掃描失敗：', stopError);
            }
            restoreUi();
        });

        await BarcodeScanner.startScan();
    } catch (error) {
        if (barcodeListener && typeof barcodeListener.remove === 'function') {
            barcodeListener.remove();
            barcodeListener = null;
        }
        restoreUi();
        console.error('startNativeScan failed:', error);

        if (isScanCancellationError(error)) {
            console.info('掃描已取消。');
            verifyStatusEl.innerText = '掃描已取消';
            verifyStatusEl.className = 'status-waiting';
            return;
        }

        if (typeof BarcodeScanner.scan === 'function') {
            console.warn('嘗試使用內建掃描備援模式...');
            await startNativeScanBuiltIn(BarcodeScanner, error);
            return;
        }

        alert('掃描發生錯誤：' + (error?.message || error));
        verifyStatusEl.innerText = '掃描錯誤';
        verifyStatusEl.className = 'status-error';
    }
}

async function startNativeScanBuiltIn(BarcodeScanner, originalError) {
    try {
        verifyStatusEl.innerText = '啟動原生內建掃描備援方案...';
        verifyStatusEl.className = 'status-waiting';

        const result = await BarcodeScanner.scan({ formats: ['QR_CODE'], autoZoom: true });
        const barcode = result?.barcodes?.[0];
        const content = barcode?.rawValue || barcode?.displayValue;

        if (content) {
            scanResultEl.innerText = content;
            verifyStatusEl.innerText = '掃描完成';
            verifyStatusEl.className = 'status-success';
            logScanPackage(content);
        } else {
            throw new Error('備援模式未取得掃描資料。');
        }
    } catch (fallbackError) {
        console.error('startNativeScanBuiltIn failed:', fallbackError, 'originalError=', originalError);
        if (isScanCancellationError(fallbackError)) {
            console.info('內建掃描已取消。');
            verifyStatusEl.innerText = '掃描已取消';
            verifyStatusEl.className = 'status-waiting';
        } else {
            alert('原生掃描啟動失敗：' + (fallbackError?.message || fallbackError));
            verifyStatusEl.innerText = '掃描錯誤';
            verifyStatusEl.className = 'status-error';
        }
    } finally {
        restoreUi();
    }
}

async function startWebScan() {
    try {
        webBarcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        videoElement.srcObject = scanStream;
        videoElement.hidden = false;
        videoElement.style.display = 'block';
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
                    const content = qr.rawValue || '未取得掃描內容。';
                    scanResultEl.innerText = content;
                    verifyStatusEl.innerText = '掃描完成';
                    verifyStatusEl.className = 'status-success';
                    logScanPackage(content);
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

let voiceAudioPreviewEl = document.getElementById('voice-audio-preview');
let voiceAudioMetaEl = document.getElementById('voice-audio-meta');
let voiceDownloadBtn = document.getElementById('voice-download-btn');

let voiceMediaRecorder = null;
let voiceAudioChunks = [];
let latestVoiceAudioBlob = null;
let latestVoiceAudioUrl = null;
let voiceRecognition = null;
let voiceRecognitionFinalText = '';
let voiceRecognitionIsActive = false;

function ensureVoicePreviewElements() {
    if (voiceAudioPreviewEl && voiceAudioMetaEl && voiceDownloadBtn) {
        return;
    }

    const voiceSection = document.querySelector('.voice-section');
    if (!voiceSection) {
        return;
    }

    const previewContainer = document.createElement('div');
    previewContainer.className = 'voice-audio-box result-box';
    previewContainer.innerHTML = `
        <h3>錄音預覽</h3>
        <audio id="voice-audio-preview" controls hidden></audio>
        <p id="voice-audio-meta">（尚未錄音...）</p>
        <button id="voice-download-btn" type="button" hidden>下載錄音</button>
    `;
    voiceSection.appendChild(previewContainer);

    voiceAudioPreviewEl = document.getElementById('voice-audio-preview');
    voiceAudioMetaEl = document.getElementById('voice-audio-meta');
    voiceDownloadBtn = document.getElementById('voice-download-btn');
}

ensureVoicePreviewElements();

function initVoiceRecognition() {
    if (voiceRecognition) {
        return voiceRecognition;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
        console.warn('此瀏覽器不支援 SpeechRecognition API。');
        return null;
    }

    voiceRecognition = new SpeechRecognitionCtor();
    voiceRecognition.lang = 'zh-TW';
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const transcript = event.results[index][0].transcript.trim();
            if (event.results[index].isFinal) {
                finalText += (finalText ? ' ' : '') + transcript;
            } else {
                interimText += (interimText ? ' ' : '') + transcript;
            }
        }

        voiceRecognitionFinalText = finalText || interimText;

        if (voiceResultEl) {
            voiceResultEl.innerText = voiceRecognitionFinalText;
        }

        if (voiceStatusEl) {
            voiceStatusEl.innerText = finalText
                ? '狀態：辨識完成。'
                : '狀態：正在辨識中...';
        }
    };

    voiceRecognition.onerror = (event) => {
        console.error('SpeechRecognition 錯誤：', event.error);
        if (voiceStatusEl) {
            voiceStatusEl.innerText = '狀態：辨識失敗，請再試一次。';
        }
    };

    voiceRecognition.onend = () => {
        voiceRecognitionIsActive = false;
    };

    return voiceRecognition;
}

function finalizeVoiceRecognition(audioBlob) {
    const transcript = (voiceRecognitionFinalText || '').trim();

    if (voiceResultEl) {
        voiceResultEl.innerText = transcript || '未辨識到文字。';
    }

    if (voiceStatusEl) {
        voiceStatusEl.innerText = transcript
            ? '狀態：語音辨識完成。'
            : '狀態：未辨識到文字，請再試一次。';
    }

    console.log('語音辨識結果：', transcript, '音檔大小：', audioBlob?.size);
}

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
    voiceRecognitionFinalText = '';
    ensureVoicePreviewElements();
    clearVoicePreview();

    try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            throw new Error('此裝置不支援 navigator.mediaDevices.getUserMedia。');
        }

        const micState = await getPermissionState('microphone');
        if (micState === 'denied') {
            alert('麥克風權限已被拒絕，請前往系統設定允許本 App 使用麥克風。');
            return;
        }

        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            console.log('偵測到 Android 原生環境，準備請求麥克風權限...');
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (typeof MediaRecorder === 'undefined') {
            stream.getTracks().forEach(track => track.stop());
            throw new Error('此 WebView 目前不支援 MediaRecorder。');
        }

        voiceMediaRecorder = new MediaRecorder(stream);

        voiceMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                voiceAudioChunks.push(event.data);
            }
        };

        voiceMediaRecorder.onstop = () => {
            const audioBlob = new Blob(voiceAudioChunks, { type: 'audio/webm' });
            latestVoiceAudioBlob = audioBlob;
            showVoicePreview(audioBlob);
            if (voiceStatusEl) {
                voiceStatusEl.innerText = '狀態：錄音完成，正在進行語音辨識...';
            }

            if (voiceRecognition && voiceRecognitionIsActive) {
                voiceRecognition.stop();
            }

            window.setTimeout(() => finalizeVoiceRecognition(audioBlob), 800);
        };

        voiceMediaRecorder.start();

        const recognition = initVoiceRecognition();
        if (recognition) {
            voiceRecognitionFinalText = '';
            voiceRecognitionIsActive = true;
            recognition.start();
        } else if (voiceStatusEl) {
            voiceStatusEl.innerText = '狀態：正在聆聽中，請說話...（此瀏覽器不支援即時辨識）';
        }

        if (voiceStatusEl && !voiceRecognitionIsActive) {
            voiceStatusEl.innerText = '狀態：正在聆聽中，請說話...';
        }
        if (voiceButton) {
            voiceButton.innerText = '停止錄音並解析';
            voiceButton.style.backgroundColor = 'red';
        }

    } catch (error) {
        console.error('麥克風啟動失敗:', error);

        let extra = '';
        try {
            if (navigator.permissions && typeof navigator.permissions.query === 'function') {
                const status = await navigator.permissions.query({ name: 'microphone' });
                extra = '\n麥克風權限狀態：' + status.state;
            }
        } catch (permError) {
            console.warn('無法查詢 microphone permission status', permError);
        }

        alert(
            '無法啟動麥克風！\n原因：' +
            (error.name || '未知錯誤') +
            '\n' +
            (error.message || '') +
            extra +
            '\n請確認系統設定中的應用程式權限，並重新啟動 App。'
        );
    }
}

// 4. 停止錄音
function stopVoiceRecording() {
    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
        if (voiceRecognition && voiceRecognitionIsActive) {
            voiceRecognition.stop();
            voiceRecognitionIsActive = false;
        }

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

function clearVoicePreview() {
    if (voiceAudioPreviewEl) {
        voiceAudioPreviewEl.pause();
        voiceAudioPreviewEl.removeAttribute('src');
        voiceAudioPreviewEl.load();
        voiceAudioPreviewEl.hidden = true;
        voiceAudioPreviewEl.style.display = 'none';
    }
    if (voiceAudioMetaEl) {
        voiceAudioMetaEl.innerText = '（尚未錄音...）';
    }
    if (voiceDownloadBtn) {
        voiceDownloadBtn.hidden = true;
    }
    if (latestVoiceAudioUrl) {
        URL.revokeObjectURL(latestVoiceAudioUrl);
        latestVoiceAudioUrl = null;
    }
}

function showVoicePreview(blob) {
    ensureVoicePreviewElements();

    if (latestVoiceAudioUrl) {
        URL.revokeObjectURL(latestVoiceAudioUrl);
    }

    latestVoiceAudioUrl = URL.createObjectURL(blob);
    latestVoiceAudioBlob = blob;

    if (voiceAudioPreviewEl) {
        voiceAudioPreviewEl.src = latestVoiceAudioUrl;
        voiceAudioPreviewEl.hidden = false;
        voiceAudioPreviewEl.style.display = 'block';
        voiceAudioPreviewEl.load();
    }

    if (voiceAudioMetaEl) {
        const sizeKb = (blob.size / 1024).toFixed(1);
        voiceAudioMetaEl.innerText = `錄音已建立，可播放。大小：${sizeKb} KB，格式：${blob.type || 'unknown'}`;
    }

    if (voiceDownloadBtn) {
        voiceDownloadBtn.hidden = false;
        voiceDownloadBtn.style.display = 'inline-block';
        voiceDownloadBtn.onclick = () => {
            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `voice-recording-${Date.now()}.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        };
    }
}

// 5. 模擬商用 API (Google STT / Whisper) 回傳
// function handleVoiceUploadMock(blob) {
//     console.log("【前端音檔錄製成功】大小為：", blob.size, "bytes");
//     
//     // 模擬後端 API 的 1.5 秒網路延遲
//     setTimeout(() => {
//         // 【核心需求 1】保證高準確度文字，先用 mock 資料做介面驗證
//         const mockSpeechToTextResult = "幫我把A05倉庫的感冒藥提出十箱送到診間";
//         
//         if (voiceResultEl) {
//             voiceResultEl.innerText = mockSpeechToTextResult;
//         }
//         if (voiceStatusEl) {
//             voiceStatusEl.innerText = "狀態：語音辨識完成！";
//         }
//         
//         // 進入下一步的意圖拆解（未來會在 FastAPI 透過 LLM 做結構化拆解）
//         parseIntentAndDispatchMock(mockSpeechToTextResult);
//         
//     }, 1500);
// }

// 6. 模擬自然語言意圖拆解與指令執行
// function parseIntentAndDispatchMock(text) {
//     // 這裡先寫一個簡單的文字比對邏輯，方便你在手機上驗證「文字轉指令」的連鎖反應
//     if (text.includes("倉庫") && text.includes("送")) {
//         console.log("【發送結構化指令至後台執行成功】", {
//             intent: "TRANSFER_MATERIAL",
//             parameters: {
//                 raw_text: text,
//                 parsed_at: new Date().toISOString()
//             }
//         });
//     }
// }

// Previously attempted Capacitor Permissions.request helper was removed to revert to original flow.

async function getPermissionState(permissionName) {
    try {
        if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
            return null;
        }
        const status = await navigator.permissions.query({ name: permissionName });
        return status.state;
    } catch (error) {
        return null;
    }
}

function getOrCreateDeviceUuid() {
    const storedUuid = localStorage.getItem('device_uuid');
    if (storedUuid) {
        return storedUuid;
    }

    const newUuid = (typeof crypto?.randomUUID === 'function')
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });

    localStorage.setItem('device_uuid', newUuid);
    return newUuid;
}

function updateDeviceUuidDisplay() {
    if (deviceUuidEl) {
        deviceUuidEl.innerText = deviceUuid || '尚未產生 UUID';
    }
}

function logScanPackage(qrContent) {
    console.log({ qrContent, deviceId: deviceUuid });
}
