(() => {
  if (window.__extftcadLoaded) {
    return;
  }

  window.__extftcadLoaded = true;

  const MESSAGE_TYPES = {
    PING: 'PING',
    ADAPT_SELECTION: 'ADAPT_SELECTION',
    ADAPT_PAGE: 'ADAPT_PAGE',
    RESTORE_ORIGINAL: 'RESTORE_ORIGINAL',
    ADAPT_TEXT_REQUEST: 'ADAPT_TEXT_REQUEST'
  };

  const SKIPPED_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'SVG',
    'CANVAS',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'BUTTON',
    'CODE',
    'PRE'
  ]);

  const MIN_PAGE_TEXT_LENGTH = 30;
  const MAX_PAGE_NODES = 80;
  const replacements = new Map();
  const replacementIdsByNode = new WeakMap();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || String(error)
      }));

    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case MESSAGE_TYPES.PING:
        return { ok: true };

      case MESSAGE_TYPES.ADAPT_SELECTION:
        return adaptSelection(message.level);

      case MESSAGE_TYPES.ADAPT_PAGE:
        return adaptPage(message.level);

      case MESSAGE_TYPES.RESTORE_ORIGINAL:
        return restoreOriginal();

      default:
        return {
          ok: false,
          error: 'Неизвестная команда расширения'
        };
    }
  }

  async function adaptSelection(level) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      throw new Error('Выделите текст на странице');
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (!selectedText) {
      throw new Error('Выделите непустой текст');
    }

    if (!isSafeSelectionRange(range)) {
      throw new Error('Этот фрагмент нельзя безопасно изменить');
    }

    const adaptedText = await requestAdaptedText({
      text: selectedText,
      level,
      mode: 'selection'
    });

    if (isSimpleTextRange(range)) {
      replaceTextRange(
        range.startContainer,
        range.startOffset,
        range.endOffset,
        adaptedText,
        level,
        'selection'
      );
    } else {
      replaceRange(range, selectedText, adaptedText, level, 'selection');
    }

    selection.removeAllRanges();

    return {
      ok: true,
      selectedText,
      adaptedText,
      level,
      mode: 'selection',
      sourceUrl: window.location.href,
      pageTitle: document.title,
      changedCount: 1
    };
  }

  async function adaptPage(level) {
    const textNodes = getPageTextNodes();

    if (textNodes.length === 0) {
      throw new Error('На странице не найден подходящий текст');
    }

    let changedCount = 0;
    const adaptedTexts = [];

    for (const textNode of textNodes) {
      const originalText = textNode.nodeValue;
      const existingReplacement = getReplacementForNode(textNode);
      const sourceText = existingReplacement?.originalText || originalText;
      const normalizedText = sourceText.trim();

      if (!normalizedText || !textNode.isConnected) {
        continue;
      }

      const adaptedText = await requestAdaptedText({
        text: normalizedText,
        level,
        mode: 'page'
      });

      replaceTextNode(
        textNode,
        sourceText,
        preserveOuterWhitespace(sourceText, adaptedText),
        level,
        'page'
      );
      adaptedTexts.push(adaptedText);
      changedCount += 1;
    }

    return {
      ok: true,
      adaptedText: adaptedTexts.join('\n\n'),
      level,
      mode: 'page',
      sourceUrl: window.location.href,
      pageTitle: document.title,
      changedCount
    };
  }

  function restoreOriginal() {
    let restoredCount = 0;

    for (const replacement of replacements.values()) {
      if (replacement.type === 'range') {
        if (!replacement.container?.isConnected) {
          continue;
        }

        replacement.container.replaceWith(replacement.originalFragment.cloneNode(true));
        restoredCount += 1;
        continue;
      }

      if (replacement.node?.isConnected) {
        replacement.node.nodeValue = replacement.originalText;
        restoredCount += 1;
      }
    }

    replacements.clear();

    return {
      ok: true,
      restoredCount
    };
  }

  function isSimpleTextRange(range) {
    return range.startContainer === range.endContainer
      && range.startContainer.nodeType === Node.TEXT_NODE;
  }

  function isSafeSelectionRange(range) {
    const commonAncestor = getElementFromNode(range.commonAncestorContainer);

    if (!commonAncestor || isUnsafeElement(commonAncestor)) {
      return false;
    }

    if (isSimpleTextRange(range)) {
      return !shouldSkipTextNode(range.startContainer);
    }

    const selectedTextNodes = getTextNodesInRange(range);

    if (selectedTextNodes.length === 0) {
      return false;
    }

    return selectedTextNodes.every((textNode) => !shouldSkipTextNode(textNode));
  }

  function replaceTextRange(textNode, startOffset, endOffset, adaptedText, level, mode) {
    const originalText = textNode.nodeValue;
    const updatedText = [
      originalText.slice(0, startOffset),
      adaptedText,
      originalText.slice(endOffset)
    ].join('');

    replaceTextNode(textNode, originalText, updatedText, level, mode);
  }

  function replaceRange(range, originalText, adaptedText, level, mode) {
    const originalFragment = range.cloneContents();
    const container = document.createElement('span');
    const id = createReplacementId();

    container.dataset.extftcadReplacementId = id;
    container.textContent = adaptedText;

    range.deleteContents();
    range.insertNode(container);

    replacements.set(id, {
      id,
      type: 'range',
      container,
      originalText,
      originalFragment,
      adaptedText,
      level,
      mode,
      timestamp: Date.now()
    });
  }

  function replaceTextNode(textNode, originalText, adaptedText, level, mode) {
    const existingId = replacementIdsByNode.get(textNode);
    const existingReplacement = existingId ? replacements.get(existingId) : null;
    const id = existingId || createReplacementId();
    const firstOriginalText = existingReplacement?.originalText || originalText;

    replacements.set(id, {
      id,
      type: 'text',
      node: textNode,
      originalText: firstOriginalText,
      adaptedText,
      level,
      mode,
      timestamp: Date.now()
    });

    replacementIdsByNode.set(textNode, id);
    textNode.nodeValue = adaptedText;
  }

  function getReplacementForNode(textNode) {
    const replacementId = replacementIdsByNode.get(textNode);

    if (!replacementId) {
      return null;
    }

    return replacements.get(replacementId) || null;
  }

  async function requestAdaptedText({ text, level, mode }) {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.ADAPT_TEXT_REQUEST,
      payload: {
        text,
        level,
        mode,
        sourceUrl: window.location.href,
        pageTitle: document.title,
        requestId: createRequestId()
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Не удалось упростить текст');
    }

    const adaptedText = String(response.payload?.adaptedText || '').trim();

    if (!adaptedText) {
      throw new Error('AI вернул пустой результат');
    }

    return adaptedText;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function getPageTextNodes() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (shouldSkipTextNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (node.nodeValue.trim().length < MIN_PAGE_TEXT_LENGTH) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!isVisibleTextNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];

    while (nodes.length < MAX_PAGE_NODES) {
      const node = walker.nextNode();

      if (!node) {
        break;
      }

      nodes.push(node);
    }

    return nodes;
  }

  function shouldSkipTextNode(node) {
    const parent = node.parentElement;

    if (!parent) {
      return true;
    }

    if (parent.isContentEditable) {
      return true;
    }

    return isUnsafeElement(parent);
  }

  function isUnsafeElement(element) {
    if (!element) {
      return true;
    }

    if (element.isContentEditable) {
      return true;
    }

    return Boolean(element.closest(Array.from(SKIPPED_TAGS).join(',')));
  }

  function getElementFromNode(node) {
    if (!node) {
      return null;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      return node;
    }

    return node.parentElement || null;
  }

  function getTextNodesInRange(range) {
    const root = range.commonAncestorContainer;
    const walkerRoot = root.nodeType === Node.TEXT_NODE
      ? root.parentNode
      : root;

    if (!walkerRoot) {
      return [];
    }

    const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!range.intersectsNode(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          if (!node.nodeValue.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let node = walker.nextNode();

    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }

    return nodes;
  }

  function isVisibleTextNode(node) {
    const parent = node.parentElement;

    if (!parent) {
      return false;
    }

    const style = window.getComputedStyle(parent);

    if (
      style.display === 'none'
      || style.visibility === 'hidden'
      || Number(style.opacity) === 0
    ) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(node);
    const hasVisibleRect = range.getClientRects().length > 0;
    range.detach();

    return hasVisibleRect;
  }

  function createReplacementId() {
    return `replacement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function preserveOuterWhitespace(originalText, adaptedText) {
    const leadingWhitespace = originalText.match(/^\s*/)?.[0] || '';
    const trailingWhitespace = originalText.match(/\s*$/)?.[0] || '';

    return `${leadingWhitespace}${adaptedText.trim()}${trailingWhitespace}`;
  }

  function createRequestId() {
    if (crypto?.randomUUID) {
      return crypto.randomUUID();
    }

    return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();
