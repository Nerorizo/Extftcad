const MESSAGE_TYPES = {
  ADAPT_SELECTION: 'ADAPT_SELECTION',
  ADAPT_PAGE: 'ADAPT_PAGE',
  RESTORE_ORIGINAL: 'RESTORE_ORIGINAL',
  PING: 'PING'
};

const STATUS = {
  idle: 'Готово к работе',
  loadingSelection: 'Упрощаю выделенный текст...',
  loadingPage: 'Упрощаю страницу...',
  restoring: 'Возвращаю оригинал...',
  openingResult: 'Открываю сохраненный текст...'
};

const DEFAULT_LEVEL = 'clear';
const STORAGE_KEYS = {
  level: 'extftcadLevel',
  lastResult: 'extftcadLastResult'
};

const PDF_PAGE = {
  width: 595.28,
  height: 841.89,
  canvasWidth: 1240,
  canvasHeight: 1754,
  margin: 96,
  fontSize: 28,
  lineHeight: 42
};

document.addEventListener('DOMContentLoaded', async () => {
  const mainView = document.getElementById('main-view');
  const resultView = document.getElementById('result-view');
  const levelSelect = document.getElementById('level');
  const adaptSelectionButton = document.getElementById('adapt-selection');
  const adaptPageButton = document.getElementById('adapt-page');
  const saveButton = document.getElementById('save');
  const restoreButton = document.getElementById('restore-original');
  const statusElement = document.getElementById('status');
  const resultStatusElement = document.getElementById('result-status');
  const resultTextElement = document.getElementById('result-text');
  const copyResultButton = document.getElementById('copy-result');
  const exportPdfButton = document.getElementById('export-pdf');
  const backToMainButton = document.getElementById('back-to-main');
  const actionButtons = [adaptSelectionButton, adaptPageButton, saveButton, restoreButton].filter(Boolean);

  const savedLevel = await getStoredLevel();
  levelSelect.value = hasOption(levelSelect, savedLevel)
    ? savedLevel
    : DEFAULT_LEVEL;

  levelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.level]: levelSelect.value });
  });

  adaptSelectionButton.addEventListener('click', () => {
    runTabAction({
      type: MESSAGE_TYPES.ADAPT_SELECTION,
      level: levelSelect.value,
      loadingText: STATUS.loadingSelection,
      successText: 'Выделенный текст упрощен',
      actionButtons,
      statusElement
    });
  });

  adaptPageButton.addEventListener('click', () => {
    runTabAction({
      type: MESSAGE_TYPES.ADAPT_PAGE,
      level: levelSelect.value,
      loadingText: STATUS.loadingPage,
      successText: 'Страница обработана',
      actionButtons,
      statusElement
    });
  });

  restoreButton.addEventListener('click', () => {
    runTabAction({
      type: MESSAGE_TYPES.RESTORE_ORIGINAL,
      level: levelSelect.value,
      loadingText: STATUS.restoring,
      successText: 'Оригинальный текст восстановлен',
      actionButtons,
      statusElement
    });
  });

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      openSavedResult({
        mainView,
        resultView,
        resultTextElement,
        resultStatusElement,
        actionButtons,
        statusElement
      });
    });
  }

  copyResultButton.addEventListener('click', async () => {
    const result = await getLastResult();

    if (!result?.adaptedText) {
      setStatus(resultStatusElement, 'Нет сохраненного текста', 'error');
      return;
    }

    try {
      await copyText(result.adaptedText);
      setStatus(resultStatusElement, 'Текст скопирован', 'success');
    } catch (error) {
      setStatus(resultStatusElement, getReadableError(error), 'error');
    }
  });

  exportPdfButton.addEventListener('click', async () => {
    const result = await getLastResult();

    if (!result?.adaptedText) {
      setStatus(resultStatusElement, 'Нет сохраненного текста', 'error');
      return;
    }

    try {
      setBusy([copyResultButton, exportPdfButton, backToMainButton], true);
      setStatus(resultStatusElement, 'Готовлю PDF...', 'loading');

      const pdfBlob = await createPdfBlob(result.adaptedText);
      downloadBlob(pdfBlob, createPdfFileName());
      setStatus(resultStatusElement, 'PDF скачан', 'success');
    } catch (error) {
      setStatus(resultStatusElement, getReadableError(error), 'error');
    } finally {
      setBusy([copyResultButton, exportPdfButton, backToMainButton], false);
    }
  });

  backToMainButton.addEventListener('click', () => {
    showMainView(mainView, resultView);
    setStatus(statusElement, STATUS.idle, 'idle');
  });

  setStatus(statusElement, STATUS.idle, 'idle');
});

async function runTabAction({
  type,
  level,
  loadingText,
  successText,
  actionButtons,
  statusElement
}) {
  try {
    setBusy(actionButtons, true);
    setStatus(statusElement, loadingText, 'loading');
    console.log('EXTFTCAD action:', { type, level });

    const tab = await getActiveTab();
    await ensureContentScript(tab.id);

    const response = await sendMessageToTab(tab.id, {
      type,
      level
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Не удалось выполнить действие');
    }

    await saveLastResult(response);

    const details = getSuccessDetails(response);
    setStatus(statusElement, details || successText, 'success');
  } catch (error) {
    setStatus(statusElement, getReadableError(error), 'error');
  } finally {
    setBusy(actionButtons, false);
  }
}

async function openSavedResult({
  mainView,
  resultView,
  resultTextElement,
  resultStatusElement,
  actionButtons,
  statusElement
}) {
  try {
    setBusy(actionButtons, true);
    setStatus(statusElement, STATUS.openingResult, 'loading');

    const result = await getLastResult();

    if (!result?.adaptedText) {
      throw new Error('Сначала упростите текст');
    }

    resultTextElement.textContent = result.adaptedText;
    setStatus(resultStatusElement, 'Готово', 'success');
    showResultView(mainView, resultView);
    setStatus(statusElement, 'Сохраненный текст открыт', 'success');
  } catch (error) {
    setStatus(statusElement, getReadableError(error), 'error');
  } finally {
    setBusy(actionButtons, false);
  }
}

function showResultView(mainView, resultView) {
  mainView.hidden = true;
  resultView.hidden = false;
}

function showMainView(mainView, resultView) {
  resultView.hidden = true;
  mainView.hidden = false;
}

async function saveLastResult(response) {
  const adaptedText = String(response?.adaptedText || '').trim();

  if (!adaptedText) {
    return;
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.lastResult]: {
      adaptedText,
      level: response.level || '',
      mode: response.mode || '',
      sourceUrl: response.sourceUrl || '',
      pageTitle: response.pageTitle || '',
      savedAt: new Date().toISOString()
    }
  });
}

async function getLastResult() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.lastResult);
  return result[STORAGE_KEYS.lastResult] || null;
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
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}] /Resources << /XObject << /Im${index + 1} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>\n`
    );
    addStreamObject(
      imageObjectId,
      `<< /Type /XObject /Subtype /Image /Width ${PDF_PAGE.canvasWidth} /Height ${PDF_PAGE.canvasHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\n`,
      imageBytes
    );
    addStreamObject(
      contentObjectId,
      `<< /Length ${content.length} >>\n`,
      encoder.encode(content)
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

async function getStoredLevel() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.level);
  return result[STORAGE_KEYS.level] || DEFAULT_LEVEL;
}

function hasOption(selectElement, value) {
  return Array.from(selectElement.options).some((option) => option.value === value);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error('Не найдена активная вкладка');
  }

  return tab;
}

async function ensureContentScript(tabId) {
  const pingResponse = await trySendMessageToTab(tabId, {
    type: MESSAGE_TYPES.PING
  });

  if (pingResponse?.ok) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js']
  });

  const retryResponse = await trySendMessageToTab(tabId, {
    type: MESSAGE_TYPES.PING
  });

  if (!retryResponse?.ok) {
    throw new Error('Не удалось подключиться к странице');
  }
}

function trySendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function setBusy(buttons, isBusy) {
  buttons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function setStatus(element, text, state) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.dataset.state = state;
}

function getSuccessDetails(response) {
  if (response.selectedText) {
    console.log('Выделенный текст:', response.selectedText);
  }

  if (typeof response.changedCount === 'number') {
    return `Обработано фрагментов: ${response.changedCount}`;
  }

  if (typeof response.restoredCount === 'number') {
    return `Восстановлено фрагментов: ${response.restoredCount}`;
  }

  return '';
}

function getReadableError(error) {
  const message = error?.message || String(error);

  if (message.includes('Cannot access') || message.includes('chrome://')) {
    return 'Chrome не разрешает расширениям работать с этой страницей';
  }

  if (message.includes('Receiving end does not exist')) {
    return 'Страница еще не готова. Обновите ее и попробуйте снова';
  }

  return message;
}
