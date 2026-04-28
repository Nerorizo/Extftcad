# Extftcad

Chrome-расширение для адаптации сложности текста на веб-страницах.

## Что уже реализовано

- Manifest V3 для Chrome.
- Popup с выбором уровня упрощения.
- Команды:
  - упростить выделенный текст;
  - упростить всю страницу;
  - вернуть оригинал.
- Content script для чтения выделения, обхода текста страницы и inline-замены.
- Background service worker для обработки запросов адаптации.
- Локальный Node/Express backend с интеграцией через GigaChat JS SDK.

## Установка в Chrome

1. Откройте `chrome://extensions`.
2. Включите `Developer mode`.
3. Нажмите `Load unpacked`.
4. Выберите папку проекта.
5. Откройте обычную веб-страницу, выделите текст и нажмите иконку расширения.

Расширение не работает на служебных страницах Chrome, например `chrome://extensions`.

## Backend

Расширение отправляет текст только в локальный backend:

```js
const BACKEND_ENDPOINT = 'http://localhost:5055/api/text/adapt';
```

Backend общается с GigaChat от имени пользователя и хранит ключ авторизации только на серверной стороне.

### Установка зависимостей

```bash
pnpm install
```

### Настройка GigaChat

1. Получите `Authorization Key` в кабинете GigaChat API.
2. Скачайте корневой сертификат НУЦ Минцифры по инструкции из документации GigaChat.
3. Создайте локальный файл `.env` на основе `.env.example`.
4. Укажите путь к сертификату в `GIGACHAT_CA_CERT_FILE`.

Пример `.env`:

```env
PORT=5055
GIGACHAT_AUTH_KEY=your_authorization_key
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_MODEL=GigaChat-2
GIGACHAT_CA_CERT_FILE=./certs/mincifry-root-ca.pem
```

### Запуск backend

```bash
pnpm dev:api
```

При старте backend сразу проверяет ключ, scope и сертификат через `giga.updateToken()`. Если что-то настроено неверно, процесс завершится с ошибкой до запуска HTTP-сервера.

### Проверка backend

Проверка health endpoint:

```bash
curl http://localhost:5055/health
```

Проверка адаптации текста:

```bash
curl -X POST http://localhost:5055/api/text/adapt \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Photosynthesis is a process used by plants to convert light energy into chemical energy.",
    "level": "clear",
    "mode": "selection",
    "sourceUrl": "https://example.com",
    "pageTitle": "Test",
    "requestId": "test-1"
  }'
```

Ожидаемый request:

```json
{
  "text": "string",
  "level": "quick | clear | notes",
  "mode": "selection | page",
  "sourceUrl": "string",
  "pageTitle": "string",
  "requestId": "string"
}
```

Ожидаемый response:

```json
{
  "adaptedText": "string",
  "requestId": "string",
  "warnings": ["string"]
}
```

### Тесты backend

```bash
pnpm test
```

## Режимы адаптации

- `clear` - проще и понятнее. Основной режим со средней степенью адаптации.
- `quick` - коротко и по делу. Для быстрого понимания сути за короткое время.
- `notes` - для конспекта. Пересказ своими словами с сохранением ключевых фактов.

## Ограничения MVP

- Выделение поддерживается только внутри одного текстового узла.
- Режим всей страницы обрабатывает до 80 подходящих текстовых фрагментов.
- Не изменяются `script`, `style`, `input`, `textarea`, `button`, `code`, `pre` и скрытые элементы.
- Оригинальный текст хранится только в памяти content script текущей страницы.
- AI напрямую из расширения не вызывается: ключи должны храниться только на backend.
- Для запуска backend нужен локально установленный сертификат Минцифры.

## Данные и приватность

Расширение отправляет на backend только текст, который пользователь явно решил обработать: выделенный фрагмент или текстовые фрагменты страницы в режиме всей страницы. Поля ввода и скрытые элементы не отправляются.

## Как это работает

1. Пользователь выделяет текст или запускает упрощение всей страницы.
2. `content-script.js` собирает текст и отправляет его в `background.js`.
3. `background.js` вызывает локальный endpoint `POST /api/text/adapt`.
4. `server.js` валидирует запрос и отправляет `messages` в GigaChat SDK.
5. GigaChat возвращает адаптированный текст, backend отдает его расширению.
6. Расширение заменяет текст на странице и хранит оригинал для восстановления.
