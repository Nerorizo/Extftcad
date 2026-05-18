const fs = require('node:fs');
const { Agent } = require('node:https');

const MAX_TEXT_LENGTH = 6000;
const DEFAULT_SCOPE = 'GIGACHAT_API_PERS';
const DEFAULT_MODEL = 'GigaChat-2';
const DEFAULT_TIMEOUT_SECONDS = 600;

const levelInstructions = {
    clear: [
        'Режим "Проще и понятнее".',
        'Перепиши и сделать текст короче и проще, ясным и естественным языком для читателя без специальной подготовки.',
        'Сохрани исходный смысл, структуру, порядок мыслей, ключевые факты, числа, даты, имена, названия, условия, ограничения и ссылки.',
        'Замени сложные слова, длинные фразы и перегруженные конструкции на понятные формулировки.',
        'Если термин важен, сохрани его и сразу дай короткое объяснение простыми словами.',
        'Не сокращай текст до тезисов: результат должен оставаться полноценным объяснением.',
        'Не добавляй факты, оценки, примеры и выводы, которых нет в исходном тексте.',
    ].join(' '),
    notes: [
        'Режим "Конспект".',
        'Преобразуй текст в компактный конспект для быстрого повторения и запоминания.',
        'Выдели главную мысль, ключевые факты, определения, причины, следствия, этапы, условия, ограничения и важные выводы.',
        'Пиши кратко, но не теряй существенную информацию.',
        'Используй ясные формулировки, короткие абзацы или списки, если это помогает структуре.',
        'Сохраняй числа, даты, имена, названия, термины, документы и ссылки без искажений.',
        'Не добавляй новые факты, пояснения и выводы от себя.',
        'Не используй форматирование текста.',
    ].join(' '),
    plain: [
        'Режим "Анти-канцелярит".',
        'Главная задача режима — именно переписать текст, убрав канцелярит, а не просто сократить или пересказать его.',
        'Сделай текст живым, конкретным, прямым и деловым.',
        'Обязательно заменяй бюрократические обороты на простые действия: кто делает, что делает и зачем.',
        'Убирай пустые вводные фразы, штампы, отглагольные существительные, пассивные конструкции, лишнюю официальность и чрезмерно длинные предложения.',
        'Заменяй формулировки вроде "осуществляется", "производится", "имеет место", "в целях", "по вопросу", "данный", "является", "в рамках", "на основании вышеизложенного" на прямые и понятные выражения.',
        'Предпочитай глаголы существительным: "проверить" вместо "осуществить проверку", "помочь" вместо "оказать содействие", "решить" вместо "произвести решение вопроса".',
        'Сохраняй юридически, финансово и организационно важные условия, ограничения, сроки, числа, имена, названия, документы и ссылки.',
        'Не делай текст разговорным, фамильярным или рекламным: стиль должен быть ясным, уважительным и профессиональным.',
        'Если исходный текст уже простой, улучши только тяжеловесные места и не усложняй его.',
        'Не сокращай смысл и не добавляй информацию от себя.',
    ].join(' '),
};

const SYSTEM_PROMPT = [
    'Ты редактируешь и упрощаешь текст по выбранному режиму.',
    'Сохраняй язык исходного текста.',
    'Главная цель — сделать текст яснее, полезнее и удобнее для чтения без потери смысла.',
    'Не добавляй новые факты, выводы, примеры или пояснения, которых нет в исходном тексте.',
    'Не искажай смысл и не опускай важные условия, ограничения, оговорки и исключения.',
    'Не изменяй числа, даты, имена, названия компаний, продуктов, сервисов, законов, документов и ссылки.',
    'Если встречаются сложные термины, упрощай их или коротко поясняй простыми словами, но не меняй исходный смысл.',
    'Если термин критически важен, сохрани его и добавь короткое понятное пояснение.',
    'Сохраняй порядок мыслей и общую структуру текста.',
    'Если в исходном тексте есть абзацы или списки, по возможности сохраняй их.',
    'Не превращай текст в краткое резюме, если это не требуется режимом "Конспект".',
    'Если текст уже простой, не переписывай его без необходимости, кроме режима "Анти-канцелярит", где нужно убрать тяжеловесные и бюрократические формулировки.',
    'Для режима "Анти-канцелярит" убирай канцеляризмы, но сохраняй профессиональный тон.',
    'Не используй Markdown, HTML или другую разметку.',
    'Не выделяй текст звездочками, подчеркиваниями, заголовками Markdown, кодовыми блоками или HTML-тегами.',
    'Не добавляй вступления, комментарии от себя или служебные фразы.',
    'Верни только измененный текст.',
].join('\n');

class PublicError extends Error {
    constructor(status, publicMessage, internalMessage) {
        super(internalMessage || publicMessage);
        this.name = 'PublicError';
        this.status = status;
        this.publicMessage = publicMessage;
    }
}

function validateAdaptRequest(payload) {
    const text = String(payload?.text || '').trim();
    const level = String(payload?.level || '').trim();
    const mode = String(payload?.mode || '').trim();

    if (!text) {
        throw new PublicError(400, 'Текст для упрощения пустой');
    }

    if (text.length > MAX_TEXT_LENGTH) {
        throw new PublicError(
            413,
            `Фрагмент слишком большой. Максимум: ${MAX_TEXT_LENGTH} символов`,
        );
    }

    if (!levelInstructions[level]) {
        throw new PublicError(400, 'Неизвестный режим адаптации');
    }

    if (mode !== 'selection' && mode !== 'page') {
        throw new PublicError(400, 'Неизвестный режим обработки');
    }

    return {
        text,
        level,
        mode,
        sourceUrl: normalizeOptionalString(payload?.sourceUrl),
        pageTitle: normalizeOptionalString(payload?.pageTitle),
        requestId:
            normalizeOptionalString(payload?.requestId) || createRequestId(),
    };
}

function buildAdaptMessages({ text, level, mode, sourceUrl, pageTitle }) {
    const userPrompt = [
        `Режим адаптации: ${levelInstructions[level]}`,
        `Режим: ${mode}`,
        sourceUrl ? `Источник: ${sourceUrl}` : '',
        pageTitle ? `Название страницы: ${pageTitle}` : '',
        '',
        'Текст:',
        text,
    ]
        .filter(Boolean)
        .join('\n');

    return [
        {
            role: 'system',
            content: SYSTEM_PROMPT,
        },
        {
            role: 'user',
            content: userPrompt,
        },
    ];
}

function extractAdaptedText(response) {
    const content = response?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        const normalizedContent = content.trim();

        if (!normalizedContent) {
            throw new PublicError(502, 'GigaChat вернул пустой ответ');
        }

        return stripMarkdownFormatting(normalizedContent);
    }

    if (Array.isArray(content)) {
        const normalizedContent = content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }

                return part?.text || part?.content || '';
            })
            .join('')
            .trim();

        if (!normalizedContent) {
            throw new PublicError(502, 'GigaChat вернул пустой ответ');
        }

        return stripMarkdownFormatting(normalizedContent);
    }

    throw new PublicError(502, 'GigaChat вернул пустой ответ');
}

function stripMarkdownFormatting(text) {
    return text
        .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '$1')
        .replace(/__([^_\n][\s\S]*?[^_\n])__/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .trim();
}

async function createGigaChatClient(config = process.env) {
    const credentials = String(config.GIGACHAT_AUTH_KEY || '').trim();
    const caCertFile = String(config.GIGACHAT_CA_CERT_FILE || '').trim();

    if (!credentials) {
        throw new PublicError(
            500,
            'Не настроен GigaChat Authorization Key',
            'GIGACHAT_AUTH_KEY is not configured',
        );
    }

    if (!caCertFile) {
        throw new PublicError(
            500,
            'Не настроен путь к сертификату Минцифры',
            'GIGACHAT_CA_CERT_FILE is not configured',
        );
    }

    const ca = fs.readFileSync(caCertFile);
    const httpsAgent = new Agent({ ca });
    const { default: GigaChat } = await import('gigachat');

    const clientOptions = {
        credentials,
        scope: String(config.GIGACHAT_SCOPE || DEFAULT_SCOPE).trim(),
        model: String(config.GIGACHAT_MODEL || DEFAULT_MODEL).trim(),
        timeout: Number(config.GIGACHAT_TIMEOUT || DEFAULT_TIMEOUT_SECONDS),
        httpsAgent,
    };

    if (config.GIGACHAT_BASE_URL) {
        clientOptions.baseUrl = String(config.GIGACHAT_BASE_URL).trim();
    }

    return new GigaChat(clientOptions);
}

async function primeGigaChatClient(client) {
    await client.updateToken();
}

async function adaptTextWithGigaChat(client, request) {
    const response = await client.chat({
        messages: buildAdaptMessages(request),
        temperature: 0.2,
        stream: false,
    });

    return extractAdaptedText(response);
}

function mapProviderError(error) {
    if (error instanceof PublicError) {
        return {
            status: error.status,
            publicMessage: error.publicMessage,
        };
    }

    const status = getErrorStatus(error);
    const message = String(error?.message || '');
    const code = String(error?.code || '');

    if (code === 'ENOENT') {
        return {
            status: 500,
            publicMessage: 'Не найден файл сертификата Минцифры',
        };
    }

    if (
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
        code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
        code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        /certificate|tls|ssl/i.test(message)
    ) {
        return {
            status: 502,
            publicMessage: 'Ошибка TLS при подключении к GigaChat',
        };
    }

    if (status === 401 || status === 403) {
        return {
            status: 502,
            publicMessage: 'Ошибка авторизации GigaChat',
        };
    }

    if (status === 404) {
        return {
            status: 502,
            publicMessage: 'Указана недоступная модель GigaChat',
        };
    }

    if (status === 422) {
        return {
            status: 422,
            publicMessage: 'Некорректный запрос к GigaChat',
        };
    }

    if (status === 429) {
        return {
            status: 429,
            publicMessage: 'Слишком много запросов. Попробуйте позже',
        };
    }

    if (status >= 500 && status < 600) {
        return {
            status: 502,
            publicMessage: 'GigaChat временно недоступен',
        };
    }

    if (/empty/i.test(message)) {
        return {
            status: 502,
            publicMessage: 'GigaChat вернул пустой ответ',
        };
    }

    return {
        status: 500,
        publicMessage: 'Не удалось адаптировать текст',
    };
}

function sanitizeError(error) {
    return {
        name: error?.name || 'Error',
        message: error?.message || String(error),
        status: getErrorStatus(error),
        code: error?.code || null,
    };
}

function normalizeOptionalString(value) {
    return String(value || '').trim();
}

function getErrorStatus(error) {
    return Number(
        error?.status ||
            error?.statusCode ||
            error?.response?.status ||
            error?.response?.statusCode ||
            0,
    );
}

function createRequestId() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

module.exports = {
    DEFAULT_MODEL,
    DEFAULT_SCOPE,
    MAX_TEXT_LENGTH,
    SYSTEM_PROMPT,
    PublicError,
    adaptTextWithGigaChat,
    buildAdaptMessages,
    createGigaChatClient,
    createRequestId,
    extractAdaptedText,
    levelInstructions,
    mapProviderError,
    primeGigaChatClient,
    sanitizeError,
    validateAdaptRequest,
};
