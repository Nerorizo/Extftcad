require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();

const PORT = Number(process.env.PORT || 5055);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-5.2';

const MAX_TEXT_LENGTH = 6000;

const levelInstructions = {
    fifth_grader: 'Объясни очень просто, как для ученика 5 класса.',
    basic: 'Упрости до базового уровня, сохрани основные понятия.',
    plain_language:
        'Сохрани суть, убери профессиональную терминологию или объясни ее простыми словами.',
};

app.use(cors());
app.use(express.json({ limit: '64kb' }));

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.post('/api/text/adapt', async (req, res) => {
    try {
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({
                error: 'OPENROUTER_API_KEY is not configured',
            });
        }

        const { text, level, mode, sourceUrl, pageTitle, requestId } =
            req.body || {};

        const normalizedText = String(text || '').trim();
        const normalizedLevel = String(level || '');
        const normalizedMode = String(mode || '');

        if (!normalizedText) {
            return res.status(400).json({
                error: 'Text is required',
            });
        }

        if (normalizedText.length > MAX_TEXT_LENGTH) {
            return res.status(413).json({
                error: `Text is too long. Max length is ${MAX_TEXT_LENGTH} characters`,
            });
        }

        if (!levelInstructions[normalizedLevel]) {
            return res.status(400).json({
                error: 'Unknown simplification level',
            });
        }

        if (normalizedMode !== 'selection' && normalizedMode !== 'page') {
            return res.status(400).json({
                error: 'Unknown adaptation mode',
            });
        }

        const adaptedText = await adaptTextWithOpenRouter({
            text: normalizedText,
            level: normalizedLevel,
            mode: normalizedMode,
            sourceUrl,
            pageTitle,
        });

        res.json({
            adaptedText,
            requestId: requestId || createRequestId(),
            warnings: [],
        });
    } catch (error) {
        console.error('Text adaptation failed:', error);

        res.status(getStatusCode(error)).json({
            error: getPublicErrorMessage(error),
        });
    }
});

async function adaptTextWithOpenRouter({
    text,
    level,
    mode,
    sourceUrl,
    pageTitle,
}) {
    const systemPrompt = [
        'Ты адаптируешь сложный текст для читателя.',
        'Сохраняй язык исходного текста.',
        'Сохраняй смысл, числа, даты, имена, ссылки и важные формулировки.',
        'Не добавляй новые факты.',
        'Не пиши вступления, комментарии или пояснения от себя.',
        'Верни только адаптированный текст.',
    ].join('\n');

    const userPrompt = [
        `Уровень адаптации: ${levelInstructions[level]}`,
        `Режим: ${mode}`,
        sourceUrl ? `Источник: ${sourceUrl}` : '',
        pageTitle ? `Название страницы: ${pageTitle}` : '',
        '',
        'Текст:',
        text,
    ]
        .filter(Boolean)
        .join('\n');

    const response = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:5055',
                'X-OpenRouter-Title': 'Extftcad',
            },
            body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt,
                    },
                    {
                        role: 'user',
                        content: userPrompt,
                    },
                ],
                temperature: 0.2,
                stream: false,
            }),
        },
    );

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        const message =
            data?.error?.message || `OpenRouter error ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    const choiceError = data?.choices?.[0]?.error;

    if (choiceError) {
        const message =
            choiceError.message || choiceError.code || 'OpenRouter choice error';
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    const adaptedText = extractMessageText(data);

    if (!adaptedText) {
        console.error(
            'OpenRouter returned no content:',
            JSON.stringify(sanitizeOpenRouterResponse(data), null, 2),
        );
        throw new Error('OpenRouter returned empty text');
    }

    return adaptedText;
}

function extractMessageText(data) {
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === 'string') {
        return content.trim();
    }

    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }

                return part?.text || part?.content || '';
            })
            .join('')
            .trim();
    }

    return '';
}

function sanitizeOpenRouterResponse(data) {
    const choice = data?.choices?.[0];
    const message = choice?.message;

    return {
        id: data?.id,
        model: data?.model,
        created: data?.created,
        finishReason: choice?.finish_reason,
        nativeFinishReason: choice?.native_finish_reason,
        choiceError: choice?.error,
        messageKeys: message ? Object.keys(message) : [],
        contentType: typeof message?.content,
        contentLength:
            typeof message?.content === 'string' ? message.content.length : null,
        hasReasoning: Boolean(message?.reasoning),
        hasReasoningDetails: Array.isArray(message?.reasoning_details),
        usage: data?.usage,
    };
}

function getStatusCode(error) {
    if (error?.status === 401) {
        return 502;
    }

    if (error?.status === 402) {
        return 402;
    }

    if (error?.status === 408) {
        return 504;
    }

    if (error?.status === 413) {
        return 413;
    }

    if (error?.status === 429) {
        return 429;
    }

    return 500;
}

function getPublicErrorMessage(error) {
    if (error?.status === 401) {
        return 'Неверный OpenRouter API key';
    }

    if (error?.status === 402) {
        return 'Недостаточно средств или превышен лимит OpenRouter';
    }

    if (error?.status === 408) {
        return 'OpenRouter не ответил вовремя';
    }

    if (error?.status === 413) {
        return 'Текст слишком большой';
    }

    if (error?.status === 429) {
        return 'Слишком много запросов. Попробуйте позже';
    }

    return 'Не удалось адаптировать текст';
}

function createRequestId() {
    if (crypto?.randomUUID) {
        return crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

app.listen(PORT, () => {
    console.log(`Extftcad API is running on http://localhost:${PORT}`);
});
