// AI 상태 표시 및 백그라운드 탐지 패스 제어 (계획 C-7)

import { ensureReviewStates } from '../core/reviewState.js';
import { checkAvailability } from '../ai/ollamaClient.js';
import { runAiDetection, createAiStats, estimateChunks, DEFAULT_MAX_CHUNKS } from '../ai/aiDetect.js';
import { AiRunLifecycle } from '../ai/lifecycle.js';
import { $, toast, showError, announce } from './dom.js';

export class AiController {
  constructor({ session, getSettings, onSyncReview, onSchedulePreview, onRenderPreviewNow }) {
    this.session = session;
    this.getSettings = getSettings;
    this.onSyncReview = onSyncReview;
    this.onSchedulePreview = onSchedulePreview;
    this.onRenderPreviewNow = onRenderPreviewNow;

    this.lifecycle = new AiRunLifecycle();
    this.stats = null;
    this.availability = { available: false, reason: 'unknown' };
  }

  resetStats() {
    this.stats = null;
  }

  isRunning() {
    return !$('#ai-status').hidden;
  }

  setBadge(state, text) {
    const badge = $('#ai-badge');
    if (badge) badge.className = `security-state ${state}`;
    const badgeText = $('#ai-badge-text');
    if (badgeText) badgeText.textContent = text;
    const settingsState = $('#settings-ai-state');
    if (settingsState) settingsState.textContent = text;
  }

  async refreshAvailability() {
    const settings = this.getSettings();
    // https로 열린 경우(GitHub Pages 등)에는 로컬 엔진에 접근할 수 없다
    if (location.protocol === 'https:') {
      this.availability = { available: false, reason: 'protocol', message: '웹에서 열람 중이라 로컬 AI를 사용할 수 없습니다.' };
      this.setBadge('off', 'AI 사용 불가 (웹 열람)');
      return;
    }
    if (!settings.enabled) {
      this.availability = { available: false, reason: 'disabled' };
      this.setBadge('off', 'AI 사용 안 함');
      return;
    }

    this.setBadge('busy', 'AI 확인 중…');
    this.availability = await checkAvailability({ endpoint: settings.endpoint, model: settings.model });
    if (this.availability.available) this.setBadge('on', `AI 준비됨 · ${settings.model}`);
    else if (this.availability.reason === 'model') this.setBadge('off', '모델 없음');
    else this.setBadge('off', 'AI 엔진 꺼짐');
  }

  async stop({ wait = false } = {}) {
    const stopped = this.lifecycle.stop({ wait });
    const statusBox = $('#ai-status');
    statusBox.hidden = true;
    statusBox.setAttribute('aria-busy', 'false');
    if (!wait) return null;
    const stats = await stopped;
    if (stats) this.stats = stats;
    return stats;
  }

  startPass() {
    const settings = this.getSettings();
    if (!settings.enabled) return Promise.resolve(null);
    const parsed = this.session.parsed;
    const candidates = this.session.candidates;
    if (!parsed) return Promise.resolve(null);

    const run = this.lifecycle.begin();
    const initialStats = createAiStats(parsed.text, {
      model: settings.model,
      maxChunks: DEFAULT_MAX_CHUNKS,
    });
    const promise = this.#performPass(run, parsed, candidates, initialStats);
    return this.lifecycle.attachPromise(run, promise);
  }

  async #performPass(run, parsed, candidates, initialStats) {
    const settings = this.getSettings();
    await this.refreshAvailability();
    if (!this.lifecycle.isCurrent(run)) {
      initialStats.stopReason = 'aborted';
      return initialStats;
    }
    if (!this.availability.available) {
      if (this.availability.reason && this.availability.reason !== 'disabled') {
        toast(`${this.availability.message || 'AI 탐지를 사용할 수 없습니다.'} 규칙 기반 결과만 표시합니다.`);
      }
      this.lifecycle.clear(run);
      return null;
    }

    const chunkCount = estimateChunks(parsed.text);
    if (chunkCount > DEFAULT_MAX_CHUNKS) {
      const minutes = Math.ceil((chunkCount * 6) / 60);
      const ok = window.confirm(
        `문서가 커서 AI 탐지에 약 ${minutes}분 이상 걸립니다 (${chunkCount}개 구간).\n`
        + `앞쪽 ${DEFAULT_MAX_CHUNKS}개 구간만 검사합니다.\n\n계속하시겠습니까?`,
      );
      if (!ok) {
        this.lifecycle.clear(run);
        return null;
      }
    }

    const controller = new AbortController();
    this.lifecycle.attachController(run, controller);
    if (!this.lifecycle.isCurrent(run)) {
      initialStats.stopReason = 'aborted';
      return initialStats;
    }

    const statusBox = $('#ai-status');
    statusBox.hidden = false;
    statusBox.setAttribute('aria-busy', 'true');
    this.setBadge('busy', 'AI 탐지 중…');
    this.#updateProgress(0, Math.min(chunkCount, DEFAULT_MAX_CHUNKS), 0);

    try {
      const completedStats = await runAiDetection(parsed, candidates, {
        endpoint: settings.endpoint,
        model: settings.model,
        signal: controller.signal,
        onChunkMerged: ({ index, total, added, stats }) => {
          if (!this.lifecycle.isCurrent(run) || this.session.parsed !== parsed) return;
          this.#updateProgress(index + 1, total, stats.addedCount);
          ensureReviewStates(added);
          this.onSyncReview();
          this.onSchedulePreview(parsed.text, candidates);

          // 검토를 마쳤다고 체크한 뒤에 새 후보가 나타나면 확인을 다시 받는다
          if (added.length > 0 && $('#final-confirm').checked) {
            $('#final-confirm').checked = false;
            $('#btn-execute').disabled = true;
            toast(`AI가 개인정보 후보 ${added.length}건을 새로 찾았습니다. 다시 확인해 주십시오.`);
          }
        },
      });
      if (this.lifecycle.isCurrent(run) && this.session.parsed === parsed) {
        this.stats = completedStats;
      }
      return completedStats;
    } catch (err) {
      if (this.lifecycle.isCurrent(run)) showError(err);
      return initialStats;
    } finally {
      if (this.lifecycle.isCurrent(run) && this.session.parsed === parsed) {
        statusBox.hidden = true;
        statusBox.setAttribute('aria-busy', 'false');
        this.onRenderPreviewNow(parsed.text, candidates);
        // AI 완료 시점에만 한 번 재정렬한다 (청크마다 재정렬하면 카드가 계속 움직임)
        this.onSyncReview({ resort: true });
        this.#finishPass();
        this.lifecycle.clear(run);
      }
    }
  }

  #finishPass() {
    if (!this.stats) { this.setBadge('off', 'AI 사용 안 함'); return; }
    if (this.stats.completed) {
      this.setBadge('on', `AI 완료 · ${this.stats.addedCount}건 추가`);
      if (this.stats.addedCount > 0) {
        toast(`AI가 규칙이 놓친 개인정보 ${this.stats.addedCount}건을 추가로 찾았습니다.`);
      }
      announce(`AI 탐지 완료. ${this.stats.addedCount}건을 추가로 찾았습니다. 후보 총 ${this.session.candidates.length}건.`);
    } else if (this.stats.stopReason === 'aborted') {
      this.setBadge('off', 'AI 중단됨');
      announce('AI 탐지를 중단했습니다.');
    } else {
      this.setBadge('off', 'AI 미완료');
      toast('AI 탐지가 끝까지 완료되지 않았습니다. 결과에 기록됩니다.', true);
      announce('AI 탐지가 완료되지 않았습니다.');
    }
  }

  #updateProgress(done, total, added) {
    const pct = total > 0 ? (done / total) * 100 : 0;
    $('#ai-progress').style.width = `${pct}%`;
    $('#ai-progressbar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('#ai-status-text').textContent = `AI 검사 ${done}/${total} · ${added}건 추가 발견`;
  }
}
