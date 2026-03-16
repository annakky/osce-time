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
  }
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
  manageToggleBtn: document.getElementById('manageToggleBtn'),
  manageSection: document.getElementById('manageSection'),
  newChecklistName: document.getElementById('newChecklistName'),
  addChecklistBtn: document.getElementById('addChecklistBtn'),
  manageChecklistSelect: document.getElementById('manageChecklistSelect'),
  deleteChecklistBtn: document.getElementById('deleteChecklistBtn'),
  renameChecklistInput: document.getElementById('renameChecklistInput'),
  renameChecklistBtn: document.getElementById('renameChecklistBtn'),
  newItemInput: document.getElementById('newItemInput'),
  addItemBtn: document.getElementById('addItemBtn'),
  manageItemsList: document.getElementById('manageItemsList')
};

void init();

async function init() {
  await syncChecklistsFromTxt();

  el.durationInput.value = String(data.durationMin);
  state.targetMs = data.durationMin * 60 * 1000;

  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  renderManageItems();
  renderLaps();
  renderTimer(0);
  updateButtons();
  updateStatus();

  bindEvents();
}

async function syncChecklistsFromTxt() {
  try {
    const manifestRes = await fetch(`${MANIFEST_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!manifestRes.ok) return;

    const files = await manifestRes.json();
    if (!Array.isArray(files) || files.length === 0) return;

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

    if (imported.length === 0) return;

    const map = new Map(data.checklists.map((c) => [c.id, c]));
    imported.forEach((c) => map.set(c.id, c));
    data.checklists = Array.from(map.values());

    if (data.checklists.some((c) => c.id.startsWith('file-'))) {
      data.checklists = data.checklists.filter((c) => c.id !== 'default-osce');
    }

    if (!getChecklistById(data.selectedChecklistId)) {
      data.selectedChecklistId = data.checklists[0]?.id || '';
    }

    saveData();
  } catch (_) {
    // file:// 로 직접 열면 fetch가 제한될 수 있으므로 기존 로컬 데이터로 계속 동작한다.
  }
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

  el.manageToggleBtn.addEventListener('click', () => {
    el.manageSection.classList.toggle('hidden');
  });

  el.addChecklistBtn.addEventListener('click', addChecklist);
  el.deleteChecklistBtn.addEventListener('click', deleteChecklist);
  el.renameChecklistBtn.addEventListener('click', renameChecklist);
  el.addItemBtn.addEventListener('click', addChecklistItem);

  el.manageChecklistSelect.addEventListener('change', renderManageItems);
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
  fillSelect(el.manageChecklistSelect, options, data.selectedChecklistId);
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

function addChecklist() {
  const name = el.newChecklistName.value.trim();
  if (!name) {
    alert('체크리스트 이름을 입력하세요.');
    return;
  }

  const id = `cl-${Date.now()}`;
  data.checklists.push({ id, name, items: [] });
  data.selectedChecklistId = id;
  el.newChecklistName.value = '';

  saveData();
  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  renderManageItems();
}

function deleteChecklist() {
  const targetId = el.manageChecklistSelect.value;
  if (!targetId) return;

  if (data.checklists.length === 1) {
    alert('최소 1개의 체크리스트는 유지되어야 합니다.');
    return;
  }

  data.checklists = data.checklists.filter((c) => c.id !== targetId);
  data.selectedChecklistId = data.checklists[0].id;

  saveData();
  renderChecklistSelects();
  resetChecklistRunState();
  renderActiveChecklist();
  renderManageItems();
}

function renameChecklist() {
  const targetId = el.manageChecklistSelect.value;
  const name = el.renameChecklistInput.value.trim();
  if (!targetId || !name) {
    alert('대상과 새 이름을 입력하세요.');
    return;
  }

  const target = getChecklistById(targetId);
  if (!target) return;
  target.name = name;
  el.renameChecklistInput.value = '';

  saveData();
  renderChecklistSelects();
  renderManageItems();
}

function addChecklistItem() {
  const targetId = el.manageChecklistSelect.value;
  const item = el.newItemInput.value.trim();
  if (!targetId || !item) {
    alert('수정 대상과 항목명을 입력하세요.');
    return;
  }

  const target = getChecklistById(targetId);
  if (!target) return;
  target.items.push(item);
  el.newItemInput.value = '';

  saveData();
  if (targetId === data.selectedChecklistId) {
    resetChecklistRunState();
    renderActiveChecklist();
  }
  renderManageItems();
}

function deleteChecklistItem(idx) {
  const targetId = el.manageChecklistSelect.value;
  const target = getChecklistById(targetId);
  if (!target) return;
  target.items.splice(idx, 1);

  saveData();
  if (targetId === data.selectedChecklistId) {
    resetChecklistRunState();
    renderActiveChecklist();
  }
  renderManageItems();
}

function renderManageItems() {
  el.manageItemsList.innerHTML = '';
  const target = getChecklistById(el.manageChecklistSelect.value);
  if (!target || target.items.length === 0) {
    const li = document.createElement('li');
    li.textContent = '항목이 없습니다.';
    el.manageItemsList.appendChild(li);
    return;
  }

  target.items.forEach((item, idx) => {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'item-row';

    const label = document.createElement('span');
    label.textContent = item;

    const del = document.createElement('button');
    del.className = 'item-delete';
    del.textContent = '삭제';
    del.addEventListener('click', () => deleteChecklistItem(idx));

    row.appendChild(label);
    row.appendChild(del);
    li.appendChild(row);
    el.manageItemsList.appendChild(li);
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
