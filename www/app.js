// 注意：如果在瀏覽器電腦測試，Capacitor 外掛會無法執行，這是正常的，必須在手機上跑。
// 我們可以透過動態載入套件或確保它在 native 環境執行

const scanButton = document.getElementById('start-scan-btn');
const scanResultEl = document.getElementById('scan-result');
const appContainer = document.getElementById('app-container');

scanButton.addEventListener('click', startScan);

async function startScan() {
    const { BarcodeScanner } = window.Capacitor?.Plugins || {};

    if (!BarcodeScanner) {
        alert('請在 Android 實機上測試掃描功能！');
        return;
    }

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
        } else {
            scanResultEl.innerText = '未取得掃描內容。';
        }
    } catch (error) {
        restoreUi();
        console.error(error);
        alert('掃描發生錯誤：' + (error?.message || error));
    }
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