const MESSAGE_TYPES = {
    ADAPT_TEXT_REQUEST: 'ADAPT_TEXT_REQUEST',
};

const BACKEND_ENDPOINT = 'http://localhost:5055/api/text/adapt';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_LENGTH = 6000;

const LEVEL_LABELS = {
    quick: 'коротко и по делу',
    clear: 'проще и понятнее',
    notes: 'для конспекта',
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPES.ADAPT_TEXT_REQUEST) {
        return false;
    }

    handleAdaptTextRequest(message.payload)
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) =>
            sendResponse({
                ok: false,
                error: normalizeError(error),
            }),
        );

    return true;
});

async function handleAdaptTextRequest(payload) {
    const request = normalizeRequest(payload);

    if (!BACKEND_ENDPOINT) {
        return mockAdaptText(request);
    }

    return fetchAdaptedText(request);
}

function normalizeRequest(payload) {
    const text = String(payload?.text || '').trim();
    const level = String(payload?.level || '');
    const mode = String(payload?.mode || '');

    if (!text) {
        throw new Error('Текст для упрощения пустой');
    }

    if (text.length > MAX_TEXT_LENGTH) {
        throw new Error(
            `Фрагмент слишком большой. Максимум: ${MAX_TEXT_LENGTH} символов`,
        );
    }

    if (!LEVEL_LABELS[level]) {
        throw new Error('Неизвестный режим адаптации');
    }

    if (mode !== 'selection' && mode !== 'page') {
        throw new Error('Неизвестный режим обработки');
    }

    return {
        text,
        level,
        mode,
        sourceUrl: payload?.sourceUrl || '',
        pageTitle: payload?.pageTitle || '',
        requestId: payload?.requestId || createRequestId(),
    };
}

async function fetchAdaptedText(request) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(BACKEND_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(
                data?.error || `Backend вернул ошибку ${response.status}`,
            );
        }

        const adaptedText = String(data?.adaptedText || '').trim();

        if (!adaptedText) {
            throw new Error('AI вернул пустой результат');
        }

        return {
            adaptedText,
            requestId: data?.requestId || request.requestId,
            warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('Backend не ответил вовремя');
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function mockAdaptText(request) {
    const prefixByLevel = {
        quick: 'Коротко: ',
        clear: 'Понятно: ',
        notes: 'Для конспекта: ',
    };

    const adaptedText = `${prefixByLevel[request.level]}${request.text}`
        .replace(/\s+/g, ' ')
        .trim();

    return {
        adaptedText,
        requestId: request.requestId,
        warnings: [
            'Используется mock-адаптация. Подключите backend endpoint в background.js.',
        ],
    };
}

function normalizeError(error) {
    const message = error?.message || String(error);

    if (message.includes('Failed to fetch')) {
        return 'Backend недоступен';
    }

    return message;
}

function createRequestId() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
