const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./server');

test('GET /health returns ok payload', async () => {
    const app = createApp({
        adaptText: async () => 'unused',
    });
    const handler = findRouteHandler(app, '/health', 'get');
    const response = createResponseRecorder();

    await handler({}, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
});

test('POST /api/text/adapt returns adapted text from service', async () => {
    const app = createApp({
        adaptText: async (request) => `Адаптировано: ${request.text}`,
    });
    const handler = findRouteHandler(app, '/api/text/adapt', 'post');
    const response = createResponseRecorder();

    await handler(
        {
            body: {
                text: 'Сложный абзац',
                level: 'clear',
                mode: 'selection',
                requestId: 'req-77',
            },
        },
        response,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        adaptedText: 'Адаптировано: Сложный абзац',
        requestId: 'req-77',
        warnings: [],
    });
});

test('POST /api/text/adapt returns validation error before service call', async () => {
    let serviceCalled = false;
    const app = createApp({
        adaptText: async () => {
            serviceCalled = true;
            return 'unused';
        },
    });
    const handler = findRouteHandler(app, '/api/text/adapt', 'post');
    const response = createResponseRecorder();

    await handler(
        {
            body: {
                text: '',
                level: 'clear',
                mode: 'selection',
            },
        },
        response,
    );

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, 'Текст для упрощения пустой');
    assert.equal(serviceCalled, false);
});

function findRouteHandler(app, path, method) {
    const routeLayer = app.router.stack.find(
        (layer) => layer.route?.path === path && layer.route.methods?.[method],
    );

    if (!routeLayer) {
        throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    }

    return routeLayer.route.stack[0].handle;
}

function createResponseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}
