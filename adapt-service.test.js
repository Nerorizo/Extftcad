const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_TEXT_LENGTH,
    PublicError,
    SYSTEM_PROMPT,
    buildAdaptMessages,
    extractAdaptedText,
    mapProviderError,
    validateAdaptRequest,
} = require('./adapt-service');

test('validateAdaptRequest normalizes a valid payload', () => {
    const result = validateAdaptRequest({
        text: '  Сложный текст  ',
        level: 'clear',
        mode: 'selection',
        sourceUrl: ' https://example.com/page ',
        pageTitle: ' Test page ',
        requestId: 'req-1',
    });

    assert.deepEqual(result, {
        text: 'Сложный текст',
        level: 'clear',
        mode: 'selection',
        sourceUrl: 'https://example.com/page',
        pageTitle: 'Test page',
        requestId: 'req-1',
    });
});

test('validateAdaptRequest rejects invalid payloads', () => {
    assert.throws(
        () => validateAdaptRequest({}),
        (error) => error instanceof PublicError && error.status === 400,
    );

    assert.throws(
        () =>
            validateAdaptRequest({
                text: 'abc',
                level: 'unknown',
                mode: 'selection',
            }),
        (error) => error instanceof PublicError && error.status === 400,
    );

    assert.throws(
        () =>
            validateAdaptRequest({
                text: 'abc',
                level: 'clear',
                mode: 'unknown',
            }),
        (error) => error instanceof PublicError && error.status === 400,
    );

    assert.throws(
        () =>
            validateAdaptRequest({
                text: 'a'.repeat(MAX_TEXT_LENGTH + 1),
                level: 'clear',
                mode: 'selection',
            }),
        (error) => error instanceof PublicError && error.status === 413,
    );
});

test('buildAdaptMessages includes system prompt and optional metadata', () => {
    const messages = buildAdaptMessages({
        text: 'Плотность вещества показывает массу в единице объема.',
        level: 'quick',
        mode: 'page',
        sourceUrl: 'https://example.com/doc',
        pageTitle: 'Физика',
    });

    assert.equal(messages[0].role, 'system');
    assert.equal(messages[0].content, SYSTEM_PROMPT);
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /Режим адаптации:/);
    assert.match(messages[1].content, /быстро понять за 1-2 минуты|ключевые факты/i);
    assert.match(messages[1].content, /Источник: https:\/\/example.com\/doc/);
    assert.match(messages[1].content, /Название страницы: Физика/);
});

test('extractAdaptedText returns string content and array content', () => {
    assert.equal(
        extractAdaptedText({
            choices: [{ message: { content: '  Упрощенный текст  ' } }],
        }),
        'Упрощенный текст',
    );

    assert.equal(
        extractAdaptedText({
            choices: [
                {
                    message: {
                        content: [{ text: 'Упрощенный ' }, { text: 'текст' }],
                    },
                },
            ],
        }),
        'Упрощенный текст',
    );
});

test('extractAdaptedText rejects empty provider responses', () => {
    assert.throws(
        () => extractAdaptedText({ choices: [{ message: { content: '' } }] }),
        (error) => error instanceof PublicError && error.status === 502,
    );

    assert.throws(
        () => extractAdaptedText({ choices: [] }),
        (error) => error instanceof PublicError && error.status === 502,
    );
});

test('mapProviderError converts provider and TLS errors to public messages', () => {
    assert.deepEqual(
        mapProviderError({ status: 401, message: 'Unauthorized' }),
        {
            status: 502,
            publicMessage: 'Ошибка авторизации GigaChat',
        },
    );

    assert.deepEqual(
        mapProviderError({ status: 404, message: 'Model not found' }),
        {
            status: 502,
            publicMessage: 'Указана недоступная модель GigaChat',
        },
    );

    assert.deepEqual(
        mapProviderError({ status: 422, message: 'Validation failed' }),
        {
            status: 422,
            publicMessage: 'Некорректный запрос к GigaChat',
        },
    );

    assert.deepEqual(
        mapProviderError({ status: 429, message: 'Rate limit' }),
        {
            status: 429,
            publicMessage: 'Слишком много запросов. Попробуйте позже',
        },
    );

    assert.deepEqual(
        mapProviderError({
            code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
            message: 'certificate verify failed',
        }),
        {
            status: 502,
            publicMessage: 'Ошибка TLS при подключении к GigaChat',
        },
    );
});
