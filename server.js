require('dotenv').config();

const cors = require('cors');
const express = require('express');

const {
    adaptTextWithGigaChat,
    createGigaChatClient,
    mapProviderError,
    primeGigaChatClient,
    sanitizeError,
    validateAdaptRequest,
} = require('./adapt-service');

function createApp({ adaptText }) {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: '64kb' }));

    app.get('/health', (req, res) => {
        res.json({ ok: true });
    });

    app.post('/api/text/adapt', async (req, res) => {
        try {
            const request = validateAdaptRequest(req.body);
            const adaptedText = await adaptText(request);

            res.json({
                adaptedText,
                requestId: request.requestId,
                warnings: [],
            });
        } catch (error) {
            const mappedError = mapProviderError(error);
            console.error('Text adaptation failed:', sanitizeError(error));

            res.status(mappedError.status).json({
                error: mappedError.publicMessage,
            });
        }
    });

    return app;
}

async function startServer(config = process.env) {
    const port = Number(config.PORT || 5055);
    const client = await createGigaChatClient(config);

    await primeGigaChatClient(client);

    const app = createApp({
        adaptText: (request) => adaptTextWithGigaChat(client, request),
    });

    return new Promise((resolve, reject) => {
        const server = app.listen(port, () => {
            resolve({ app, server, port });
        });

        server.once('error', reject);
    });
}

if (require.main === module) {
    startServer()
        .then(({ port }) => {
            console.log(`Extftcad API is running on http://localhost:${port}`);
        })
        .catch((error) => {
            console.error('Failed to start Extftcad API:', sanitizeError(error));
            process.exit(1);
        });
}

module.exports = {
    createApp,
    startServer,
};
