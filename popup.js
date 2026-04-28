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
  restoring: 'Возвращаю оригинал...'
};

const DEFAULT_LEVEL = 'clear';
const STORAGE_KEYS = {
  level: 'extftcadLevel'
};

document.addEventListener('DOMContentLoaded', async () => {
  const levelSelect = document.getElementById('level');
  const adaptSelectionButton = document.getElementById('adapt-selection');
  const adaptPageButton = document.getElementById('adapt-page');
  const restoreButton = document.getElementById('restore-original');
  const statusElement = document.getElementById('status');
  const actionButtons = [adaptSelectionButton, adaptPageButton, restoreButton];

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

    const details = getSuccessDetails(response);
    setStatus(statusElement, details || successText, 'success');
  } catch (error) {
    setStatus(statusElement, getReadableError(error), 'error');
  } finally {
    setBusy(actionButtons, false);
  }
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
