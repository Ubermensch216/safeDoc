// 설정 탭 제어 — 처리 정책·AI 엔진·사용자 정의 규칙·초기화

import { PII_TYPES, ACTION_LABELS } from '../detect/types.js';
import { checkAvailability, DEFAULT_ENDPOINT, DEFAULT_MODEL } from '../ai/ollamaClient.js';
import { previewReplacement } from '../core/deidentify.js';
import { $, $$, toast, escapeHtml } from './dom.js';
import {
  defaultAiSettings,
  saveStoredPolicies,
  loadStoredAiSettings,
  saveStoredAiSettings,
  clearStoredSettings,
} from './storage.js';

// 처리방식의 결과를 미리 보여 주기 위한 가상 값
const POLICY_SAMPLES = {
  PERSON_NAME: '홍길동',
  RRN: '900101-1234567',
  FOREIGNER_NO: '900101-5234567',
  PHONE_MOBILE: '010-1234-5678',
  PHONE_LANDLINE: '02-123-4567',
  EMAIL: 'hong@example.com',
  ADDRESS: '서울시 중구 세종대로 110',
  ACCOUNT_NO: '123-456-789012',
  CARD_NO: '1234-5678-9012-3456',
  PASSPORT_NO: 'M12345678',
  BUSINESS_NO: '123-45-67890',
  VEHICLE_NO: '12가 3456',
  IP_ADDRESS: '192.168.0.1',
  BIRTH_DATE: '1990-01-01',
  CUSTOM: 'EMP-000123',
};

function policyExampleHtml(code, action) {
  const sample = POLICY_SAMPLES[code] || '예시 값';
  return `${escapeHtml(sample)} → <b>${escapeHtml(previewReplacement(code, action, sample))}</b>`;
}

export function createSettingsController({ session, onPoliciesChanged, onAiSettingsChanged }) {
  let aiSettings = loadStoredAiSettings();
  let userRules = []; // 사용자 정의 탐지 규칙 (세션 한정, FR-803)

  function syncAiInputs() {
    $('#ai-enabled').checked = aiSettings.enabled;
    $('#ai-endpoint').value = aiSettings.endpoint;
    $('#ai-model').value = aiSettings.model;
  }

  function renderPolicyList() {
    $('#policy-list').innerHTML = Object.entries(PII_TYPES).map(([code, def]) => `
<div class="policy-item">
  <span class="policy-name">${escapeHtml(def.label)}</span>
  <select data-type="${code}" aria-label="${escapeHtml(def.label)} 기본 처리방식">
    ${Object.entries(ACTION_LABELS).map(([a, label]) =>
      `<option value="${a}"${session.typePolicies[code] === a ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
  </select>
  <span class="policy-example" data-example="${code}">${policyExampleHtml(code, session.typePolicies[code])}</span>
</div>`).join('');
  }

  function renderRuleList() {
    $('#rule-list').innerHTML = userRules
      .map((r, i) => `<li><strong>${escapeHtml(r.name)}</strong> <code>${escapeHtml(r.pattern)}</code>`
        + `<span class="sp"></span><button class="btn tiny rule-delete" data-index="${i}">삭제</button></li>`)
      .join('');
  }

  function bindNavigation() {
    $$('.settings-nav-btn').forEach((button) => {
      button.addEventListener('click', () => {
        $$('.settings-nav-btn').forEach((item) => {
          item.classList.toggle('active', item === button);
          if (item === button) item.setAttribute('aria-current', 'true');
          else item.removeAttribute('aria-current');
        });
        $$('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === button.dataset.settings));
        const activePanel = $(`[data-settings-panel="${button.dataset.settings}"]`);
        const heading = activePanel?.querySelector('h3');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      });
    });
  }

  function bind() {
    syncAiInputs();
    renderPolicyList();
    bindNavigation();

    $('#policy-list').addEventListener('change', (e) => {
      const type = e.target.dataset.type;
      if (!type) return;
      session.typePolicies[type] = e.target.value;
      $(`[data-example="${type}"]`).innerHTML = policyExampleHtml(type, e.target.value);
      saveStoredPolicies(session.typePolicies);
      onPoliciesChanged();
    });

    $('#ai-enabled').addEventListener('change', (e) => {
      aiSettings.enabled = e.target.checked;
      saveStoredAiSettings(aiSettings);
      onAiSettingsChanged();
    });
    $('#ai-endpoint').addEventListener('change', (e) => {
      aiSettings.endpoint = e.target.value.trim() || DEFAULT_ENDPOINT;
      $('#ai-endpoint').value = aiSettings.endpoint;
      saveStoredAiSettings(aiSettings);
    });
    $('#ai-model').addEventListener('change', (e) => {
      aiSettings.model = e.target.value.trim() || DEFAULT_MODEL;
      $('#ai-model').value = aiSettings.model;
      saveStoredAiSettings(aiSettings);
    });

    $('#btn-ai-test').addEventListener('click', async () => {
      const out = $('#ai-test-result');
      out.className = 'test-result';
      out.textContent = '확인 중…';
      const result = await checkAvailability({ endpoint: aiSettings.endpoint, model: aiSettings.model });
      if (result.models?.length) {
        $('#ai-model-list').innerHTML = result.models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join('');
      }
      if (result.available) {
        out.className = 'test-result ok';
        out.textContent = `연결됨 — Ollama ${result.version} · ${aiSettings.model}`;
      } else {
        out.className = 'test-result bad';
        out.textContent = result.message || '연결할 수 없습니다.';
      }
      onAiSettingsChanged();
    });

    $('#btn-add-rule').addEventListener('click', () => {
      const name = $('#rule-name').value.trim();
      const pattern = $('#rule-pattern').value.trim();
      if (!name || !pattern) {
        toast('규칙 이름과 정규표현식을 입력하십시오.', true);
        return;
      }
      try {
        new RegExp(pattern, 'g');
      } catch {
        toast('올바르지 않은 정규표현식입니다.', true);
        return;
      }
      userRules.push({ name, pattern, type: 'CUSTOM' });
      renderRuleList();
      $('#rule-name').value = '';
      $('#rule-pattern').value = '';
      toast('규칙을 추가했습니다. 다음 분석부터 적용됩니다.');
    });

    $('#rule-list').addEventListener('click', (e) => {
      if (!e.target.classList.contains('rule-delete')) return;
      userRules.splice(Number(e.target.dataset.index), 1);
      renderRuleList();
    });

    // 설정 초기화 (FR-804)
    $('#btn-reset-settings').addEventListener('click', () => {
      if (!window.confirm('처리 정책, AI 연결 설정, 사용자 규칙을 모두 기본값으로 되돌립니다.\n계속하시겠습니까?')) return;
      clearStoredSettings();
      session.typePolicies = session.defaultPolicies();
      aiSettings = defaultAiSettings();
      userRules = [];
      syncAiInputs();
      renderPolicyList();
      renderRuleList();
      onPoliciesChanged();
      onAiSettingsChanged();
      toast('설정을 초기 상태로 되돌렸습니다.');
    });
  }

  return {
    bind,
    getAiSettings: () => aiSettings,
    getUserRules: () => userRules,
  };
}
