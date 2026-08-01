// AI 비동기 실행을 현재 작업 세션과 격리한다.
// 이전 실행의 Promise가 늦게 끝나도 새 세션의 상태나 UI를 갱신하지 못하게 한다.

export class AiRunLifecycle {
  constructor() {
    this.current = null;
    this.sequence = 0;
  }

  begin() {
    const run = {
      id: ++this.sequence,
      controller: null,
      promise: null,
    };
    this.current = run;
    return run;
  }

  isCurrent(run) {
    return this.current === run;
  }

  attachController(run, controller) {
    run.controller = controller;
    if (!this.isCurrent(run)) controller.abort();
  }

  attachPromise(run, promise) {
    run.promise = promise;
    return promise;
  }

  clear(run) {
    if (this.isCurrent(run)) this.current = null;
  }

  // 현재 실행을 먼저 무효화한 후 취소한다. 따라서 종료 과정의 콜백도
  // isCurrent(run) 검사에서 걸러진다. wait=true이면 최종 감사 통계를 돌려준다.
  async stop({ wait = false } = {}) {
    const run = this.current;
    if (!run) return null;
    this.current = null;
    run.controller?.abort();
    if (!wait || !run.promise) return null;
    try {
      return await run.promise;
    } catch {
      return null;
    }
  }
}
