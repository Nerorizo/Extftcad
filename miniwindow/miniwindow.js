async function initExtensionUI() {
    const host = document.createElement('div');
    host.id = 'my-translator-root';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    // 1. HTML файл
    const response = await fetch(chrome.runtime.getURL('miniwindow/miniwindow.html'));
    const htmlContent = await response.text();

    // 2. Элемент link для подключения CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('miniwindow/miniwindow.css');

    // 3. Основные элементы
    const btn = document.createElement('button');
    btn.id = 'trigger-btn';
    btn.style.backgroundImage = `url('${chrome.runtime.getURL('src/icon.png')}')`;
    
    const win = document.createElement('div');
    win.id = 'mini-window';
    win.innerHTML = htmlContent;

    shadow.appendChild(link);
    shadow.appendChild(btn);
    shadow.appendChild(win);

    return { btn, win, host, shadow };
}

initExtensionUI().then(({ btn, win, shadow, host }) => {
    
    // Переменная для хранения текста (теперь она внутри блока)
    let selectedText = "";

    // 1. Логика появления кнопки при выделении
    document.addEventListener('mouseup', (e) => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        // 1. Проверяем, был ли клик внутри нашего Shadow DOM
        // Используем e.target, так как это надежнее внутри одного скрипта
        const isClickInside = e.composedPath().includes(host); 

        if (text.length > 0) {
            // Если текст выделен — показываем кнопку
            selectedText = text;
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            btn.style.display = 'flex';
            btn.style.left = `${rect.right + window.scrollX + 10}px`;
            btn.style.top = `${rect.top + window.scrollY - 10}px`;
            
            // Не закрываем окно, если оно уже открыто и мы перевыделяем текст
        } else {
            // Если текста нет И клик был НЕ по нашему окну/кнопке — только тогда закрываем
            if (!isClickInside) {
                btn.style.display = 'none';
                win.style.display = 'none';
            }
        }
    });

    // 2. Клик по кнопке (открываем окно)
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Позиционируем окно там же, где кнопка
        win.style.left = btn.style.left;
        win.style.top = btn.style.top;
        win.style.display = 'block';
        btn.style.display = 'none';

        // ПРИМЕР: Вставляем выделенный текст в элемент внутри загруженного HTML
        const submitBtn = shadow.getElementById('submit-button');
        const sourceArea = shadow.getElementById('source-area');
        const resultArea = shadow.getElementById('result-area');
        const levelSelect = shadow.getElementById('level');
        
        if (sourceArea) {
            sourceArea.value = selectedText;
        }
        let adoptedText = "";
        //new code
        submitBtn.addEventListener('click', async () => {
            const textToProcess = sourceArea.value.trim();
            const selectedLevel = levelSelect.value;

            chrome.runtime.sendMessage({
                type: 'ADAPT_TEXT_REQUEST', // Тот самый тип, который понимает ваш ИИ
                payload: {
                    text: textToProcess,
                    level: levelSelect.value,
                    mode: 'selection'
                }
            }, (response) => {
                if (response && response.ok) {
                    resultArea.value = response.payload.adaptedText;
                } else {
                    resultArea.value = "Ошибка: " + (response?.error || "неизвестно");
                }
            });
        });
    });
});
