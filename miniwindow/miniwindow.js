const MESSAGE_TYPES = {
    ADAPT_TEXT_REQUEST: 'ADAPT_TEXT_REQUEST',
};

const STATUS = {
    idle: 'Готово к работе',
    loading: 'Упрощаю выделенный текст...',
};

const DEFAULT_LEVEL = 'clear';
const STORAGE_KEYS = {
    level: 'extftcadLevel',
};

const PDF_PAGE = {
    width: 595.28,
    height: 841.89,
    canvasWidth: 1240,
    canvasHeight: 1754,
    margin: 96,
    fontSize: 28,
    lineHeight: 42,
};

async function initExtensionUI() {
    const host = document.createElement('div');
    host.id = 'my-translator-root';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const response = await fetch(chrome.runtime.getURL('miniwindow/miniwindow.html'));
    const htmlContent = await response.text();

    const sharedLink = document.createElement('link');
    sharedLink.rel = 'stylesheet';
    sharedLink.href = chrome.runtime.getURL('shared-ui.css');

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('miniwindow/miniwindow.css');

    const button = document.createElement('button');
    button.id = 'trigger-btn';
    button.type = 'button';
    button.style.backgroundImage = `url('${chrome.runtime.getURL('src/icon.png')}')`;

    const windowElement = document.createElement('div');
    windowElement.id = 'mini-window';
    windowElement.innerHTML = htmlContent;

    shadow.appendChild(sharedLink);
    shadow.appendChild(link);
    shadow.appendChild(button);
    shadow.appendChild(windowElement);

    return { button, windowElement, host, shadow };
}

initExtensionUI().then(({ button, windowElement, host, shadow }) => {
    let selectedText = '';
    let adaptedText = '';

    const mainView = shadow.getElementById('main-view');
    const resultView = shadow.getElementById('result-view');
    const levelSelect = shadow.getElementById('level');
    const adaptButton = shadow.getElementById('adapt-selection');
    const statusElement = shadow.getElementById('status');
    const sourceTextElement = shadow.getElementById('source-text-display');
    const resultStatusElement = shadow.getElementById('result-status');
    const resultTextElement = shadow.getElementById('result-text');
    const copyButton = shadow.getElementById('copy-result');
    const exportPdfButton = shadow.getElementById('export-pdf');
    const backButton = shadow.getElementById('back-to-main');
    const backButtonIcon = shadow.getElementById('back-to-main-icon');
    const resultButtons = [copyButton, exportPdfButton, backButton];

    backButtonIcon.src = chrome.runtime.getURL('src/arrow_back.svg');

    getStoredLevel().then((savedLevel) => {
        levelSelect.value = hasOption(levelSelect, savedLevel)
            ? savedLevel
            : DEFAULT_LEVEL;
    });

    levelSelect.addEventListener('change', () => {
        chrome.storage.local.set({ [STORAGE_KEYS.level]: levelSelect.value });
    });

    document.addEventListener('mouseup', (event) => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        const isClickInside = event.composedPath().includes(host);

        if (isClickInside) {
            return;
        }

        if (text) {
            selectedText = text;
            adaptedText = '';
            updateSourcePreview(sourceTextElement, selectedText);
            showMainView(mainView, resultView);
            setStatus(statusElement, STATUS.idle, 'idle');
            setStatus(resultStatusElement, 'Готово', 'success');
            positionNearSelection(button, selection);
            button.style.display = 'flex';
            return;
        }

        button.style.display = 'none';
        windowElement.style.display = 'none';
    });

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        windowElement.style.left = button.style.left;
        windowElement.style.top = button.style.top;
        windowElement.style.display = 'block';
        button.style.display = 'none';
        updateSourcePreview(sourceTextElement, selectedText);
        showMainView(mainView, resultView);
    });

    adaptButton.addEventListener('click', async () => {
        try {
            const textToProcess = selectedText.trim();

            if (!textToProcess) {
                throw new Error('Выделите текст на странице');
            }

            setBusy([adaptButton], true);
            setStatus(statusElement, STATUS.loading, 'loading');

            const response = await sendRuntimeMessage({
                type: MESSAGE_TYPES.ADAPT_TEXT_REQUEST,
                payload: {
                    text: textToProcess,
                    level: levelSelect.value,
                    mode: 'selection',
                    sourceUrl: window.location.href,
                    pageTitle: document.title,
                    requestId: createRequestId(),
                },
            });

            if (!response?.ok) {
                throw new Error(response?.error || 'Не удалось упростить текст');
            }

            adaptedText = String(response.payload?.adaptedText || '').trim();

            if (!adaptedText) {
                throw new Error('AI вернул пустой результат');
            }

            resultTextElement.textContent = adaptedText;
            setStatus(resultStatusElement, 'Готово', 'success');
            showResultView(mainView, resultView);
            setStatus(statusElement, 'Выделенный текст упрощен', 'success');
        } catch (error) {
            setStatus(statusElement, getReadableError(error), 'error');
        } finally {
            setBusy([adaptButton], false);
        }
    });

    copyButton.addEventListener('click', async () => {
        try {
            if (!adaptedText) {
                throw new Error('Нет упрощенного текста');
            }

            await copyText(adaptedText);
            setStatus(resultStatusElement, 'Текст скопирован', 'success');
        } catch (error) {
            setStatus(resultStatusElement, getReadableError(error), 'error');
        }
    });

    exportPdfButton.addEventListener('click', async () => {
        try {
            if (!adaptedText) {
                throw new Error('Нет упрощенного текста');
            }

            setBusy(resultButtons, true);
            setStatus(resultStatusElement, 'Готовлю PDF...', 'loading');

            const pdfBlob = await createPdfBlob(adaptedText);
            downloadBlob(pdfBlob, createPdfFileName());
            setStatus(resultStatusElement, 'PDF скачан', 'success');
        } catch (error) {
            setStatus(resultStatusElement, getReadableError(error), 'error');
        } finally {
            setBusy(resultButtons, false);
        }
    });

    backButton.addEventListener('click', () => {
        showMainView(mainView, resultView);
        setStatus(statusElement, STATUS.idle, 'idle');
    });
});

function positionNearSelection(button, selection) {
    if (!selection || selection.rangeCount === 0) {
        return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    button.style.left = `${rect.right + window.scrollX + 10}px`;
    button.style.top = `${rect.top + window.scrollY - 10}px`;
}

function updateSourcePreview(element, text) {
    element.textContent = text || 'Выделите текст на странице';
}

function showResultView(mainView, resultView) {
    mainView.hidden = true;
    resultView.hidden = false;
}

function showMainView(mainView, resultView) {
    resultView.hidden = true;
    mainView.hidden = false;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            resolve(response);
        });
    });
}

async function getStoredLevel() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.level);
    return result[STORAGE_KEYS.level] || DEFAULT_LEVEL;
}

function hasOption(selectElement, value) {
    return Array.from(selectElement.options).some((option) => option.value === value);
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-1000px';
    document.body.appendChild(textArea);
    textArea.select();

    try {
        const copied = document.execCommand('copy');

        if (!copied) {
            throw new Error('Не удалось скопировать текст');
        }
    } finally {
        textArea.remove();
    }
}

async function createPdfBlob(text) {
    const pages = renderTextPages(text);
    const images = await Promise.all(pages.map(canvasToJpegBytes));

    return buildPdfBlob(images);
}

function renderTextPages(text) {
    const canvases = [];
    const lines = wrapTextForPdf(text);
    let lineIndex = 0;

    do {
        const canvas = document.createElement('canvas');
        canvas.width = PDF_PAGE.canvasWidth;
        canvas.height = PDF_PAGE.canvasHeight;

        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#1d1d1f';
        context.font = `${PDF_PAGE.fontSize}px Arial, sans-serif`;
        context.textBaseline = 'top';

        let y = PDF_PAGE.margin;
        const maxY = canvas.height - PDF_PAGE.margin;

        while (lineIndex < lines.length && y + PDF_PAGE.lineHeight <= maxY) {
            context.fillText(lines[lineIndex], PDF_PAGE.margin, y);
            y += PDF_PAGE.lineHeight;
            lineIndex += 1;
        }

        canvases.push(canvas);
    } while (lineIndex < lines.length);

    return canvases;
}

function wrapTextForPdf(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const maxWidth = PDF_PAGE.canvasWidth - PDF_PAGE.margin * 2;
    const paragraphs = text.split(/\r?\n/);
    const lines = [];

    context.font = `${PDF_PAGE.fontSize}px Arial, sans-serif`;

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            lines.push('');
            continue;
        }

        const words = paragraph.split(/\s+/);
        let currentLine = '';

        for (const word of words) {
            const candidate = currentLine ? `${currentLine} ${word}` : word;

            if (context.measureText(candidate).width <= maxWidth) {
                currentLine = candidate;
                continue;
            }

            if (currentLine) {
                lines.push(currentLine);
            }

            if (context.measureText(word).width <= maxWidth) {
                currentLine = word;
                continue;
            }

            const splitLines = splitLongWord(word, context, maxWidth);
            lines.push(...splitLines.slice(0, -1));
            currentLine = splitLines.at(-1) || '';
        }

        if (currentLine) {
            lines.push(currentLine);
        }
    }

    return lines.length ? lines : [''];
}

function splitLongWord(word, context, maxWidth) {
    const parts = [];
    let currentPart = '';

    for (const character of word) {
        const candidate = `${currentPart}${character}`;

        if (context.measureText(candidate).width <= maxWidth) {
            currentPart = candidate;
            continue;
        }

        if (currentPart) {
            parts.push(currentPart);
        }

        currentPart = character;
    }

    if (currentPart) {
        parts.push(currentPart);
    }

    return parts;
}

function canvasToJpegBytes(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Не удалось подготовить страницу PDF'));
                return;
            }

            blob.arrayBuffer()
                .then((buffer) => resolve(new Uint8Array(buffer)))
                .catch(reject);
        }, 'image/jpeg', 0.92);
    });
}

function buildPdfBlob(images) {
    const chunks = [];
    const offsets = [0];
    let byteLength = 0;
    const encoder = new TextEncoder();
    const objectCount = 2 + images.length * 3;

    appendText('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    addObject(1, `<< /Type /Catalog /Pages 2 0 R >>\n`);
    addObject(2, `<< /Type /Pages /Kids [${images.map((_, index) => `${getPageObjectId(index)} 0 R`).join(' ')}] /Count ${images.length} >>\n`);

    images.forEach((imageBytes, index) => {
        const pageObjectId = getPageObjectId(index);
        const imageObjectId = getImageObjectId(index);
        const contentObjectId = getContentObjectId(index);
        const content = `q\n${PDF_PAGE.width} 0 0 ${PDF_PAGE.height} 0 0 cm\n/Im${index + 1} Do\nQ\n`;

        addObject(
            pageObjectId,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}] /Resources << /XObject << /Im${index + 1} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\n`,
        );
        addStreamObject(
            imageObjectId,
            `<< /Type /XObject /Subtype /Image /Width ${PDF_PAGE.canvasWidth} /Height ${PDF_PAGE.canvasHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\n`,
            imageBytes,
        );
        addStreamObject(
            contentObjectId,
            `<< /Length ${content.length} >>\n`,
            encoder.encode(content),
        );
    });

    const xrefOffset = byteLength;
    appendText(`xref\n0 ${objectCount + 1}\n`);
    appendText('0000000000 65535 f \n');

    for (let objectId = 1; objectId <= objectCount; objectId += 1) {
        appendText(`${String(offsets[objectId]).padStart(10, '0')} 00000 n \n`);
    }

    appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return new Blob(chunks, { type: 'application/pdf' });

    function addObject(objectId, body) {
        offsets[objectId] = byteLength;
        appendText(`${objectId} 0 obj\n${body}endobj\n`);
    }

    function addStreamObject(objectId, dictionary, bytes) {
        offsets[objectId] = byteLength;
        appendText(`${objectId} 0 obj\n${dictionary}stream\n`);
        appendBytes(bytes);
        appendText('\nendstream\nendobj\n');
    }

    function appendText(text) {
        appendBytes(encoder.encode(text));
    }

    function appendBytes(bytes) {
        chunks.push(bytes);
        byteLength += bytes.length;
    }
}

function getPageObjectId(index) {
    return 3 + index * 3;
}

function getImageObjectId(index) {
    return 4 + index * 3;
}

function getContentObjectId(index) {
    return 5 + index * 3;
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function createPdfFileName() {
    const date = new Date().toISOString().slice(0, 10);
    return `extftcad-result-${date}.pdf`;
}

function setBusy(buttons, isBusy) {
    buttons.forEach((button) => {
        button.disabled = isBusy;
    });
}

function setStatus(element, text, state) {
    element.textContent = text;
    element.dataset.state = state;
}

function getReadableError(error) {
    return error?.message || String(error);
}

function createRequestId() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
