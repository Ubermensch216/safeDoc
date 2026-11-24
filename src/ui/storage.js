// 로컬 설정 영속화 (개인정보 원문은 저장하지 않는다, FR-805)

import { ACTION_LABELS } from '../detect/types.js';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from '../ai/ollamaClient.js';

const POLICY_STORAGE_KEY = 'safedoc-type-policies';
const AI_STORAGE_KEY = 'safedoc-ai-settings';

export function defaultAiSettings() {
  return { enabled: true, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL };
}

export function loadStoredPolicies(typePolicies) {
  try {
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const [type, action] of Object.entries(saved)) {
      if (typePolicies[type] && ACTION_LABELS[action]) typePolicies[type] = action;
    }
  } catch { /* 설정 손상 시 기본값 사용 */ }
}

export function saveStoredPolicies(typePolicies) {
  try {
    localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(typePolicies));
  } catch { /* 저장 실패는 무시 */ }
}

export function loadStoredAiSettings() {
  const defaults = defaultAiSettings();
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveStoredAiSettings(settings) {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* 무시 */ }
}

export function clearStoredSettings() {
  try {
    localStorage.removeItem(POLICY_STORAGE_KEY);
    localStorage.removeItem(AI_STORAGE_KEY);
  } catch { /* 무시 */ }
}
