const STORAGE_KEY = 'med-exam-timer-v1';
const MANIFEST_PATH = 'checklists-manifest.json';
const DEFAULT_DURATION_MIN = 12;

const defaultData = {
  durationMin: DEFAULT_DURATION_MIN,
  selectedChecklistId: 'default-osce',
  checklists: [
    {
      id: 'default-osce',
      name: '기본 OSCE 체크리스트',
      items: ['손 위생', '자기소개 및 환자 확인', '주요 증상 질문', '신체진찰 핵심 수행', '요약 및 설명']
    }
  ]
};

let data = loadData();

const state = {
  running: false,
  startTs: null,
  pausedElapsedMs: 0,
  targetMs: data.durationMin * 60 * 1000,
  ticker: null,
  laps: [],
  checklistRunState: [],
  announced: {
    start: false,
    twoMin: false,
    end: false
  },
  editModal: {
    mode: null,
    checklistId: null,
    draft: null
  },
  drag: {
    active: false,
    pointerId: null,
    sourceIndex: -1,
    placeholderEl: null,
    ghostEl: null,
    lastInsertIndex: null,
    grabOffsetX: 0,
    grabOffsetY: 0
  },
  deleteTargetId: null
};

const el = {
  durationInput: document.getElementById('durationInput'),
  timerDisplay: document.getElementById('timerDisplay'),
  timerStatus: document.getElementById('timerStatus'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  lapBtn: document.getElementById('lapBtn'),
  resetBtn: document.getElementById('resetBtn'),
  lapList: document.getElementById('lapList'),
  checklistSelect: document.getElementById('checklistSelect'),
  activeChecklist: document.getElementById('activeChecklist'),
  resetChecklistBtn: document.getElementById('resetChecklistBtn'),
  openAddChecklistBtn: document.getElementById('openAddChecklistBtn'),
  openEditChecklistBtn: document.getElementById('openEditChecklistBtn'),
  openDeleteChecklistBtn: document.getElementById('openDeleteChecklistBtn'),

  manageModal: document.getElementById('manageModal'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  manageModalTitle: document.getElementById('manageModalTitle'),
  modalChecklistNameInput: document.getElementById('modalChecklistNameInput'),
  modalNewItemInput: document.getElementById('modalNewItemInput'),
  modalAddItemBtn: document.getElementById('modalAddItemBtn'),
  modalItemsList: document.getElementById('modalItemsList'),
  modalCancelBtn: document.getElementById('modalCancelBtn'),
  modalSaveBtn: document.getElementById('modalSaveBtn'),

  deleteConfirmModal: document.getElementById('deleteConfirmModal'),
  deleteModalBackdrop: document.getElementById('deleteModalBackdrop'),
  deleteModalText: document.getElementById('deleteModalText'),
  deleteNoBtn: document.getElementById('deleteNoBtn'),
  deleteYesBtn: document.getElementById('deleteYesBtn'),

  resetConfirmModal: document.getElementById('resetConfirmModal'),
  resetModalBackdrop: document.getElementById('resetModalBackdrop'),
  resetNoBtn: document.getElementById('resetNoBtn'),
  resetYesBtn: document.getElementById('resetYesBtn')
};

void init();

async function init() {
  if (!hasStoredData()) {
    await bootstrapChecklistsFromTxt();
  }

  el.durationInput.value = String(data.durationMin);
  state.targetMs = data.durationMin * 60 * 1000;

  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  renderLaps();
  renderTimer(0);
  updateButtons();
  updateStatus();

  bindEvents();
}

function bindEvents() {
  el.durationInput.addEventListener('change', () => {
    const val = clampNumber(parseInt(el.durationInput.value, 10), 1, 180, DEFAULT_DURATION_MIN);
    data.durationMin = val;
    state.targetMs = val * 60 * 1000;
    saveData();
    if (!state.running && state.pausedElapsedMs === 0) {
      renderTimer(0);
    }
  });

  el.startBtn.addEventListener('click', startTimer);
  el.pauseBtn.addEventListener('click', pauseTimer);
  el.lapBtn.addEventListener('click', addLap);
  el.resetBtn.addEventListener('click', hardReset);

  el.resetChecklistBtn.addEventListener('click', openResetConfirmModal);
  if (el.openAddChecklistBtn) el.openAddChecklistBtn.addEventListener('click', openAddChecklistModal);
  if (el.openEditChecklistBtn) el.openEditChecklistBtn.addEventListener('click', openEditChecklistModal);
  if (el.openDeleteChecklistBtn) el.openDeleteChecklistBtn.addEventListener('click', openDeleteChecklistModal);

  el.checklistSelect.addEventListener('change', () => {
    if (state.running) {
      alert('타이머 진행 중에는 체크리스트를 변경할 수 없습니다.');
      el.checklistSelect.value = data.selectedChecklistId;
      return;
    }
    data.selectedChecklistId = el.checklistSelect.value;
    saveData();
    resetChecklistRunState();
    renderActiveChecklist();
  });

  el.modalBackdrop.addEventListener('click', closeManageModal);
  el.modalCancelBtn.addEventListener('click', closeManageModal);
  el.modalSaveBtn.addEventListener('click', saveManageModal);
  el.modalAddItemBtn.addEventListener('click', addDraftItem);
  el.modalNewItemInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDraftItem();
    }
  });

  el.modalItemsList.addEventListener('pointerdown', onModalItemsPointerDown);
  el.modalItemsList.addEventListener('pointermove', onModalItemsPointerMove);
  el.modalItemsList.addEventListener('pointerup', onModalItemsPointerUpOrCancel);
  el.modalItemsList.addEventListener('pointercancel', onModalItemsPointerUpOrCancel);

  el.deleteModalBackdrop.addEventListener('click', closeDeleteModal);
  el.deleteNoBtn.addEventListener('click', closeDeleteModal);
  el.deleteYesBtn.addEventListener('click', confirmDeleteChecklist);

  el.resetModalBackdrop.addEventListener('click', closeResetModal);
  el.resetNoBtn.addEventListener('click', closeResetModal);
  el.resetYesBtn.addEventListener('click', confirmResetChecklist);
}

function hasStoredData() {
  return !!localStorage.getItem(STORAGE_KEY);
}

async function bootstrapChecklistsFromTxt() {
  try {
    const imported = await fetchTxtChecklists();
    if (imported.length === 0) return;
    data.checklists = imported;
    data.selectedChecklistId = imported[0].id;
    saveData();
  } catch (_) {
    // fallback to default
  }
}

async function fetchTxtChecklists() {
  const manifestRes = await fetch(`${MANIFEST_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  if (!manifestRes.ok) return [];

  const files = await manifestRes.json();
  if (!Array.isArray(files)) return [];

  const imported = [];
  for (const file of files) {
    if (typeof file !== 'string' || !file.toLowerCase().endsWith('.txt')) continue;

    const txtRes = await fetch(`${encodeURI(file)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!txtRes.ok) continue;

    const raw = await txtRes.text();
    const items = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    imported.push({
      id: `file-${file}`,
      name: file.replace(/\.txt$/i, ''),
      items
    });
  }

  return imported;
}

function openAddChecklistModal() {
  if (state.running) return;
  const id = `cl-${Date.now()}`;
  state.editModal.mode = 'add';
  state.editModal.checklistId = id;
  state.editModal.draft = { id, name: '', items: [] };

  el.manageModalTitle.textContent = '체크리스트 추가';
  el.modalSaveBtn.textContent = '추가';
  el.modalChecklistNameInput.value = '';
  el.modalNewItemInput.value = '';
  renderDraftItems();
  el.manageModal.classList.remove('hidden');
}

function openEditChecklistModal() {
  if (state.running) return;
  const current = getChecklistById(data.selectedChecklistId);
  if (!current) {
    alert('수정할 체크리스트가 없습니다.');
    return;
  }

  state.editModal.mode = 'edit';
  state.editModal.checklistId = current.id;
  state.editModal.draft = structuredClone(current);

  el.manageModalTitle.textContent = '체크리스트 수정';
  el.modalSaveBtn.textContent = '수정';
  el.modalChecklistNameInput.value = current.name;
  el.modalNewItemInput.value = '';
  renderDraftItems();
  el.manageModal.classList.remove('hidden');
}

function closeManageModal() {
  cleanupModalDrag();
  state.editModal.mode = null;
  state.editModal.checklistId = null;
  state.editModal.draft = null;
  el.manageModal.classList.add('hidden');
}

function saveManageModal() {
  if (!state.editModal.draft) return;

  const name = el.modalChecklistNameInput.value.trim();
  if (!name) {
    alert('체크리스트 이름을 입력하세요.');
    return;
  }

  state.editModal.draft.name = name;

  if (state.editModal.mode === 'add') {
    data.checklists.push(structuredClone(state.editModal.draft));
    data.selectedChecklistId = state.editModal.draft.id;
  } else if (state.editModal.mode === 'edit') {
    const idx = data.checklists.findIndex((c) => c.id === state.editModal.checklistId);
    if (idx < 0) {
      alert('수정 대상을 찾을 수 없습니다.');
      return;
    }
    data.checklists[idx] = structuredClone(state.editModal.draft);
  }

  saveData();
  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  closeManageModal();
}

function addDraftItem() {
  if (!state.editModal.draft) return;
  const item = el.modalNewItemInput.value.trim();
  if (!item) {
    alert('항목명을 입력하세요.');
    return;
  }
  state.editModal.draft.items.push(item);
  el.modalNewItemInput.value = '';
  renderDraftItems();
}

function deleteDraftItem(index) {
  if (!state.editModal.draft) return;
  state.editModal.draft.items.splice(index, 1);
  renderDraftItems();
}

function renderDraftItems() {
  el.modalItemsList.innerHTML = '';
  const draft = state.editModal.draft;

  if (!draft || draft.items.length === 0) {
    const li = document.createElement('li');
    li.textContent = '항목이 없습니다.';
    el.modalItemsList.appendChild(li);
    return;
  }

  draft.items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'draggable-item';
    li.draggable = false;
    li.dataset.index = String(idx);

    const row = document.createElement('div');
    row.className = 'item-row';

    const label = document.createElement('span');
    label.textContent = item;

    const del = document.createElement('button');
    del.className = 'item-delete';
    del.textContent = '삭제';
    del.addEventListener('click', () => deleteDraftItem(idx));

    row.appendChild(label);
    row.appendChild(del);
    li.appendChild(row);
    el.modalItemsList.appendChild(li);
  });
}

function openDeleteChecklistModal() {
  if (state.running) return;
  const current = getChecklistById(data.selectedChecklistId);
  if (!current) {
    alert('삭제할 체크리스트가 없습니다.');
    return;
  }
  if (data.checklists.length === 1) {
    alert('최소 1개의 체크리스트는 유지되어야 합니다.');
    return;
  }

  state.deleteTargetId = current.id;
  el.deleteModalText.textContent = `'${current.name}' 체크리스트를 정말로 삭제할까요?`;
  el.deleteConfirmModal.classList.remove('hidden');
}

function closeDeleteModal() {
  state.deleteTargetId = null;
  el.deleteConfirmModal.classList.add('hidden');
}

function confirmDeleteChecklist() {
  if (!state.deleteTargetId) return;

  data.checklists = data.checklists.filter((c) => c.id !== state.deleteTargetId);
  data.selectedChecklistId = data.checklists[0]?.id || '';

  saveData();
  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  closeDeleteModal();
}

function openResetConfirmModal() {
  if (state.running) {
    alert('타이머 진행 중에는 체크리스트를 초기화할 수 없습니다.');
    return;
  }
  el.resetConfirmModal.classList.remove('hidden');
}

function closeResetModal() {
  el.resetConfirmModal.classList.add('hidden');
}

async function confirmResetChecklist() {
  await resetChecklistStorageAndReload();
  closeResetModal();
}

function cleanupModalDrag() {
  const dragging = el.modalItemsList.querySelector('.draggable-item.dragging');
  if (dragging) dragging.classList.remove('dragging');

  if (state.drag.placeholderEl?.parentNode) state.drag.placeholderEl.parentNode.removeChild(state.drag.placeholderEl);
  if (state.drag.ghostEl?.parentNode) state.drag.ghostEl.parentNode.removeChild(state.drag.ghostEl);

  state.drag.active = false;
  state.drag.pointerId = null;
  state.drag.sourceIndex = -1;
  state.drag.placeholderEl = null;
  state.drag.ghostEl = null;
  state.drag.lastInsertIndex = null;
  state.drag.grabOffsetX = 0;
  state.drag.grabOffsetY = 0;
}

function onModalItemsPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (!state.editModal.draft) return;
  if (event.target.closest('.item-delete')) return;

  const itemEl = event.target.closest('.draggable-item');
  if (!itemEl) return;

  const sourceIndex = parseInt(itemEl.dataset.index || '-1', 10);
  if (Number.isNaN(sourceIndex) || sourceIndex < 0) return;

  event.preventDefault();
  cleanupModalDrag();

  state.drag.active = true;
  state.drag.pointerId = event.pointerId;
  state.drag.sourceIndex = sourceIndex;
  state.drag.lastInsertIndex = sourceIndex;

  const itemRect = itemEl.getBoundingClientRect();
  state.drag.grabOffsetX = event.clientX - itemRect.left;
  state.drag.grabOffsetY = event.clientY - itemRect.top;

  const placeholder = document.createElement('li');
  placeholder.className = 'drag-placeholder';
  placeholder.style.height = `${itemRect.height}px`;
  placeholder.textContent = '여기에 놓기';
  state.drag.placeholderEl = placeholder;

  itemEl.classList.add('dragging');
  itemEl.after(placeholder);

  const ghost = itemEl.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${itemRect.width}px`;
  document.body.appendChild(ghost);
  state.drag.ghostEl = ghost;
  moveGhost(event.clientX, event.clientY);
}

function onModalItemsPointerMove(event) {
  if (!state.drag.active) return;
  if (state.drag.pointerId !== event.pointerId) return;

  event.preventDefault();
  moveGhost(event.clientX, event.clientY);
  updatePlaceholderByY(event.clientY);
}

function onModalItemsPointerUpOrCancel(event) {
  if (!state.drag.active) return;
  if (state.drag.pointerId !== event.pointerId) return;

  event.preventDefault();
  applyDraftReorder();
  cleanupModalDrag();
  renderDraftItems();
}

function moveGhost(clientX, clientY) {
  if (!state.drag.ghostEl) return;
  state.drag.ghostEl.style.left = `${clientX - state.drag.grabOffsetX}px`;
  state.drag.ghostEl.style.top = `${clientY - state.drag.grabOffsetY}px`;
}

function updatePlaceholderByY(clientY) {
  if (!state.drag.active || !state.drag.placeholderEl) return;

  const list = el.modalItemsList;
  const items = Array.from(list.querySelectorAll('.draggable-item:not(.dragging)'));
  if (items.length === 0) {
    list.appendChild(state.drag.placeholderEl);
    state.drag.lastInsertIndex = 0;
    return;
  }

  let nextInsertIndex = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height * 0.5) {
      nextInsertIndex = i;
      break;
    }
  }

  const prevIndex = state.drag.lastInsertIndex;
  if (typeof prevIndex === 'number' && Math.abs(nextInsertIndex - prevIndex) === 1) {
    const pivot = Math.max(nextInsertIndex, prevIndex) - 1;
    if (pivot >= 0 && pivot < items.length) {
      const pivotRect = items[pivot].getBoundingClientRect();
      const boundary = pivotRect.top + pivotRect.height * 0.5;
      if (Math.abs(clientY - boundary) < 14) {
        nextInsertIndex = prevIndex;
      }
    }
  }

  if (nextInsertIndex === prevIndex) return;

  const referenceNode = items[nextInsertIndex] || null;
  list.insertBefore(state.drag.placeholderEl, referenceNode);
  state.drag.lastInsertIndex = nextInsertIndex;
}

function applyDraftReorder() {
  if (!state.editModal.draft || state.editModal.draft.items.length <= 1) return;

  const sourceIndex = state.drag.sourceIndex;
  const insertIndex = typeof state.drag.lastInsertIndex === 'number' ? state.drag.lastInsertIndex : sourceIndex;
  if (sourceIndex < 0 || insertIndex < 0 || sourceIndex === insertIndex) return;

  const moved = state.editModal.draft.items.splice(sourceIndex, 1)[0];
  state.editModal.draft.items.splice(insertIndex, 0, moved);
}

async function resetChecklistStorageAndReload() {
  localStorage.removeItem(STORAGE_KEY);
  data = structuredClone(defaultData);

  await bootstrapChecklistsFromTxt();

  closeManageModal();
  closeDeleteModal();

  el.durationInput.value = String(data.durationMin);
  state.targetMs = data.durationMin * 60 * 1000;
  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  updateButtons();
  updateStatus();
  renderTimer(state.pausedElapsedMs);
}

function startTimer() {
  if (state.running) return;

  if (!data.selectedChecklistId || !getChecklistById(data.selectedChecklistId)) {
    alert('체크리스트를 먼저 선택해 주세요.');
    return;
  }

  if (state.pausedElapsedMs === 0) {
    resetChecklistRunState();
    renderActiveChecklist();
    state.laps = [];
    renderLaps();
    state.announced = { start: false, twoMin: false, end: false };
  }

  state.running = true;
  state.startTs = Date.now() - state.pausedElapsedMs;
  state.ticker = window.setInterval(tick, 100);

  if (!state.announced.start) {
    speak('시험시작');
    state.announced.start = true;
  }

  updateButtons();
  updateStatus();
  tick();
}

function pauseTimer() {
  if (!state.running) return;
  state.running = false;
  state.pausedElapsedMs = Date.now() - state.startTs;
  clearInterval(state.ticker);
  state.ticker = null;
  updateButtons();
  updateStatus();
}

function hardReset() {
  state.running = false;
  clearInterval(state.ticker);
  state.ticker = null;
  state.startTs = null;
  state.pausedElapsedMs = 0;
  state.laps = [];
  state.announced = { start: false, twoMin: false, end: false };

  data.durationMin = DEFAULT_DURATION_MIN;
  state.targetMs = DEFAULT_DURATION_MIN * 60 * 1000;
  el.durationInput.value = String(DEFAULT_DURATION_MIN);
  saveData();

  resetChecklistRunState();
  renderActiveChecklist();
  renderLaps();
  renderTimer(0);
  updateButtons();
  updateStatus();
}

function tick() {
  const elapsed = Date.now() - state.startTs;
  const remaining = state.targetMs - elapsed;
  renderTimer(elapsed);
  maybeAnnounce(remaining);
}

function maybeAnnounce(remaining) {
  if (remaining <= 2 * 60 * 1000 && !state.announced.twoMin) {
    speak('종료 2분전');
    state.announced.twoMin = true;
  }
  if (remaining <= 0 && !state.announced.end) {
    speak('시험 종료');
    state.announced.end = true;
  }
}

function addLap() {
  if (!state.running) return;
  const elapsed = Date.now() - state.startTs;
  const remaining = state.targetMs - elapsed;
  state.laps.unshift({
    at: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
    elapsed,
    remaining
  });
  renderLaps();
}

function renderLaps() {
  el.lapList.innerHTML = '';
  if (state.laps.length === 0) {
    const li = document.createElement('li');
    li.textContent = '랩 기록이 없습니다.';
    el.lapList.appendChild(li);
    return;
  }

  state.laps.forEach((lap, idx) => {
    const li = document.createElement('li');
    li.textContent = `#${state.laps.length - idx} | 경과 ${formatMs(lap.elapsed)} | 남은 ${formatSigned(lap.remaining)} | 기록 ${lap.at}`;
    el.lapList.appendChild(li);
  });
}

function renderTimer(elapsedMs) {
  const remaining = state.targetMs - elapsedMs;
  el.timerDisplay.textContent = formatSigned(remaining);
  el.timerDisplay.classList.toggle('overtime', remaining < 0);
}

function updateStatus() {
  if (state.running) {
    el.timerStatus.textContent = '진행 중';
    return;
  }
  if (state.pausedElapsedMs > 0) {
    el.timerStatus.textContent = '일시정지';
    return;
  }
  el.timerStatus.textContent = '대기 중';
}

function updateButtons() {
  el.startBtn.disabled = state.running;
  el.pauseBtn.disabled = !state.running;
  el.lapBtn.disabled = !state.running;
  el.durationInput.disabled = state.running || state.pausedElapsedMs > 0;
  el.checklistSelect.disabled = state.running;
  el.resetChecklistBtn.disabled = state.running;
  if (el.openAddChecklistBtn) el.openAddChecklistBtn.disabled = state.running;
  if (el.openEditChecklistBtn) el.openEditChecklistBtn.disabled = state.running;
  if (el.openDeleteChecklistBtn) el.openDeleteChecklistBtn.disabled = state.running;
}

function resetChecklistRunState() {
  const current = getChecklistById(data.selectedChecklistId);
  state.checklistRunState = current ? current.items.map(() => false) : [];
}

function renderActiveChecklist() {
  el.activeChecklist.innerHTML = '';
  const current = getChecklistById(data.selectedChecklistId);

  if (!current) {
    const li = document.createElement('li');
    li.textContent = '체크리스트가 없습니다. 먼저 추가해 주세요.';
    el.activeChecklist.appendChild(li);
    return;
  }

  if (current.items.length === 0) {
    const li = document.createElement('li');
    li.textContent = '이 체크리스트에는 항목이 없습니다.';
    el.activeChecklist.appendChild(li);
    return;
  }

  current.items.forEach((item, idx) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!state.checklistRunState[idx];
    cb.addEventListener('change', () => {
      state.checklistRunState[idx] = cb.checked;
    });

    const span = document.createElement('span');
    span.textContent = item;

    label.appendChild(cb);
    label.appendChild(span);
    li.appendChild(label);
    el.activeChecklist.appendChild(li);
  });
}

function renderChecklistSelects() {
  const options = data.checklists;
  if (options.length === 0) {
    data.selectedChecklistId = '';
  } else if (!getChecklistById(data.selectedChecklistId)) {
    data.selectedChecklistId = options[0].id;
  }

  fillSelect(el.checklistSelect, options, data.selectedChecklistId);
}

function fillSelect(selectEl, items, selectedId) {
  selectEl.innerHTML = '';
  if (items.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '체크리스트 없음';
    selectEl.appendChild(opt);
    return;
  }

  items.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function getChecklistById(id) {
  return data.checklists.find((c) => c.id === id);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function formatSigned(ms) {
  if (ms >= 0) return formatMs(ms);
  return `+${formatMs(Math.abs(ms))}`;
}

function formatMs(ms) {
  const totalSec = Math.floor(Math.max(ms, 0) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function clampNumber(v, min, max, fallback) {
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultData);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.checklists) || parsed.checklists.length === 0) {
      return structuredClone(defaultData);
    }
    return {
      durationMin: clampNumber(parsed.durationMin, 1, 180, DEFAULT_DURATION_MIN),
      selectedChecklistId: String(parsed.selectedChecklistId || parsed.checklists[0].id),
      checklists: parsed.checklists
        .filter((c) => c && c.id && c.name && Array.isArray(c.items))
        .map((c) => ({ id: String(c.id), name: String(c.name), items: c.items.map((it) => String(it)) }))
    };
  } catch (_) {
    return structuredClone(defaultData);
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
