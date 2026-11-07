/* MAZORA Continuous PDF Reader */
(function () {
'use strict';

const state = {
  pdf: null,
  page: 1,
  zoom: 1,
  observer: null,
  rendered: new Set(),
  textCache: new Map(),
  scrollHandler: null,
  token: 0,
  searchToken: 0,
  pinchStartDistance: 0,
  pinchStartZoom: 1,
  pinchLastDistance: 0
};

const $ = id => document.getElementById(id);
const stage = () => $('readerStage');
const pages = () => $('pdfPages');

function updateLabel() {
  if (!state.pdf) return;
  $('readerPageLabel').textContent =
    `Page ${state.page} of ${state.pdf.numPages}`;
}

function saveProgress() {
  if (!state.pdf) return;

  if (typeof window.saveReaderLocation === 'function')
    window.saveReaderLocation(String(state.page));

  if (typeof window.saveReadingProgress === 'function') {
    window.saveReadingProgress({
      page: state.page,
      total: state.pdf.numPages,
      percent: state.page / state.pdf.numPages * 100,
      format: 'pdf'
    });
  }
}

async function renderPage(number) {
  if (!state.pdf || state.rendered.has(number)) return;

  const wrapper = $('pdf-page-' + number);
  if (!wrapper || wrapper.dataset.rendering === '1') return;

  wrapper.dataset.rendering = '1';
  const token = state.token;

  try {
    const page = await state.pdf.getPage(number);
    if (token !== state.token) return;

    const base = page.getViewport({scale: 1});
    const width = Math.max(180, stage().clientWidth - 24);
    const viewport = page.getViewport({
      scale: width / base.width * state.zoom
    });

    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', {alpha: false});

    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';

    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    wrapper.replaceChildren(canvas);
    wrapper.style.minHeight = Math.round(viewport.height) + 'px';

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    if (token === state.token) {
      state.rendered.add(number);
    } else {
      canvas.remove();
    }
  } catch (error) {
    console.error('PDF page error:', error);
    wrapper.textContent = 'Unable to render page ' + number;
  } finally {
    wrapper.dataset.rendering = '0';
  }
}

function renderNearby() {
  if (!state.pdf) return;

  for (
    let n = Math.max(1, state.page - 2);
    n <= Math.min(state.pdf.numPages, state.page + 3);
    n++
  ) renderPage(n);
}

function updateCurrentPage() {
  if (!state.pdf) return;

  const top = stage().getBoundingClientRect().top + 12;

  for (const element of pages().querySelectorAll('.pdf-page')) {
    if (element.getBoundingClientRect().bottom > top) {
      const number = Number(element.dataset.page);

      if (number !== state.page) {
        state.page = number;
        updateLabel();
        saveProgress();
      }
      break;
    }
  }

  renderNearby();
}

function jumpToPage(number) {
  if (!state.pdf) return;

  state.page = Math.max(
    1,
    Math.min(state.pdf.numPages, Number(number) || 1)
  );

  updateLabel();

  const target = $('pdf-page-' + state.page);
  if (target) target.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  renderPage(state.page);
  saveProgress();
}

async function open(record, book) {
  close();

  if (!window.pdfjsLib)
    throw new Error('PDF.js is not loaded.');

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    './js/vendor/pdf.worker.min.js';

  attachTouchHandlers();

  state.pdf = await pdfjsLib.getDocument({
    data: await record.blob.arrayBuffer()
  }).promise;

  state.page = Math.max(
    1,
    Math.min(
      Number(book.readingLocation || book.lastReadPage) || 1,
      state.pdf.numPages
    )
  );

  state.zoom = 1;
  state.textCache.clear();
  state.rendered.clear();

  $('readerOverlay').classList.add('pdf-continuous-mode');
  pages().classList.remove('reader-hidden');
  $('epubView').classList.add('reader-hidden');
  $('readerStatus').textContent = record.name;

  pages().innerHTML = '';

  for (let n = 1; n <= state.pdf.numPages; n++) {
    const element = document.createElement('section');
    element.className = 'pdf-page';
    element.id = 'pdf-page-' + n;
    element.dataset.page = n;
    element.innerHTML =
      '<div class="pdf-page-placeholder">Page ' + n + '</div>';
    pages().appendChild(element);
  }

  if ('IntersectionObserver' in window) {
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const n = Number(entry.target.dataset.page);

        if (entry.isIntersecting) {
          renderPage(n);
        } else if (Math.abs(n - state.page) > 4) {
          const canvas = entry.target.querySelector('canvas');
          if (canvas) {
            canvas.remove();
            state.rendered.delete(n);
          }
        }
      });
    }, {
      root: stage(),
      rootMargin: '900px 0px'
    });

    pages().querySelectorAll('.pdf-page').forEach(element => {
      state.observer.observe(element);
    });
  }

  state.scrollHandler = () => {
    if (state.scrollHandler.pending) return;
    state.scrollHandler.pending = true;

    requestAnimationFrame(() => {
      state.scrollHandler.pending = false;
      updateCurrentPage();
    });
  };

  stage().addEventListener('scroll', state.scrollHandler, {
    passive: true
  });

  updateLabel();

  requestAnimationFrame(() => {
    const target = $('pdf-page-' + state.page);
    if (target) target.scrollIntoView({block: 'start'});
    renderNearby();
  });
}

async function search(query) {
  if (!state.pdf) return [];

  query = String(query || '').trim().toLowerCase();
  if (!query) return [];

  const token = ++state.searchToken;
  const matches = [];

  for (let n = 1; n <= state.pdf.numPages; n++) {
    if (token !== state.searchToken) return [];

    let text = state.textCache.get(n);

    if (text === undefined) {
      const page = await state.pdf.getPage(n);
      const content = await page.getTextContent();
      text = content.items.map(item => item.str || '').join(' ');
      state.textCache.set(n, text);
    }

    let position = 0;
    const lower = text.toLowerCase();

    while ((position = lower.indexOf(query, position)) !== -1) {
      matches.push({
        page: n,
        excerpt: text.slice(
          Math.max(0, position - 55),
          Math.min(text.length, position + query.length + 75)
        ).replace(/\s+/g, ' ')
      });

      position += query.length;
      if (matches.length >= 100) break;
    }

    if (matches.length >= 100) break;
  }

  return matches;
}


function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function handleTouchStart(event) {
  if (!state.pdf || event.touches.length !== 2) return;
  state.pinchStartDistance = touchDistance(event.touches);
  state.pinchLastDistance = state.pinchStartDistance;
  state.pinchStartZoom = state.zoom;
}

function handleTouchMove(event) {
  if (!state.pdf || event.touches.length !== 2 ||
      !state.pinchStartDistance) return;
  event.preventDefault();
  state.pinchLastDistance = touchDistance(event.touches);
}

function handleTouchEnd(event) {
  if (!state.pinchStartDistance || event.touches.length >= 2) return;

  const ratio = state.pinchLastDistance / state.pinchStartDistance;
  const nextZoom = state.pinchStartZoom * ratio;

  state.pinchStartDistance = 0;
  state.pinchLastDistance = 0;

  if (Number.isFinite(nextZoom) && Math.abs(nextZoom - state.zoom) > 0.04) {
    zoom(nextZoom);
  }
}

function attachTouchHandlers() {
  const element = stage();
  if (!element || element.dataset.pinchReady === "1") return;

  element.dataset.pinchReady = "1";
  element.addEventListener("touchstart", handleTouchStart, {passive: true});
  element.addEventListener("touchmove", handleTouchMove, {passive: false});
  element.addEventListener("touchend", handleTouchEnd, {passive: true});
  element.addEventListener("touchcancel", handleTouchEnd, {passive: true});
}

function zoom(value) {
  if (!state.pdf) return;

  state.zoom = Math.max(.7, Math.min(2.2, Number(value) || 1));
  state.token++;
  state.rendered.clear();

  pages().querySelectorAll('.pdf-page').forEach(element => {
    element.innerHTML =
      '<div class="pdf-page-placeholder">Page ' +
      element.dataset.page + '</div>';
    element.style.minHeight = '180px';
    element.dataset.rendering = '0';
  });

  renderNearby();
}

function close() {
  state.searchToken++;
  state.token++;

  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }

  if (state.scrollHandler && stage()) {
    stage().removeEventListener('scroll', state.scrollHandler);
  }

  state.scrollHandler = null;
  state.pdf = null;
  state.rendered.clear();
  state.textCache.clear();
}

window.MAZORA_PDF_READER = {
  open,
  close,
  search,
  jumpToPage,
  previous: () => jumpToPage(state.page - 1),
  next: () => jumpToPage(state.page + 1),
  zoom,
  fit: () => zoom(1),
  getCurrentPage: () => state.page
};

})();
