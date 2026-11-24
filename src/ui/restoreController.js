// 원본 복원 탭 제어

import { validateAndRead, downloadBlob, resultFileName } from '../core/fileManager.js';
import { parseDocument, restoreDocument } from '../core/analyzer.js';
import { parseMappingTable } from '../core/mappingTable.js';
import { $, escapeHtml, showError } from './dom.js';

export function bindRestoreEvents() {
  const docInput = $('#restore-doc-input');
  const mapInput = $('#restore-map-input');
  const btn = $('#btn-restore');
  const validation = $('#restore-validation');
  let validatedTable = null;

  const showFileName = (input, labelSelector) => {
    const file = input.files[0];
    const label = $(labelSelector);
    label.dataset.placeholder ??= label.textContent;
    label.textContent = file ? file.name : label.dataset.placeholder;
    input.closest('.file-field').classList.toggle('has-file', Boolean(file));
  };

  const validatePair = async () => {
    showFileName(docInput, '#restore-doc-name');
    showFileName(mapInput, '#restore-map-name');
    $('#restore-result').hidden = true;
    btn.disabled = true;
    validatedTable = null;
    if (!(docInput.files.length > 0 && mapInput.files.length > 0)) {
      validation.className = 'restore-validation muted';
      validation.textContent = '두 파일을 선택하면 일치 여부와 복원 가능 항목을 확인합니다.';
      return;
    }
    try {
      const docFile = docInput.files[0];
      const table = parseMappingTable(await mapInput.files[0].text());
      const matches = !table.resultFileName || table.resultFileName === docFile.name;
      const reversible = table.mappings.filter((item) => item.reversible).length;
      const irreversible = table.mappings.length - reversible;
      if (!matches) {
        validation.className = 'restore-validation alert-warn';
        validation.textContent = `파일이 일치하지 않습니다. 이 대응표는 “${table.resultFileName}”용입니다.`;
        return;
      }
      validatedTable = table;
      validation.className = 'restore-validation alert-ok';
      validation.textContent = `파일 일치 확인 · 복원 가능 ${reversible}건 · 복원 불가 ${irreversible}건 · 원본 파일은 덮어쓰지 않습니다.`;
      btn.disabled = reversible === 0;
    } catch (err) {
      validation.className = 'restore-validation alert-warn';
      validation.textContent = err.message || '대응표 파일을 확인할 수 없습니다.';
    }
  };

  docInput.addEventListener('change', validatePair);
  mapInput.addEventListener('change', validatePair);

  btn.addEventListener('click', async () => {
    try {
      const docFile = docInput.files[0];
      const mapFile = mapInput.files[0];
      const read = await validateAndRead(docFile);
      const parsed = await parseDocument(read);
      const mappingTable = validatedTable || parseMappingTable(await mapFile.text());

      const { blob, restoredCount, notRestoredCount } = await restoreDocument(parsed, mappingTable);
      const name = resultFileName(docFile.name, '_복원');
      downloadBlob(blob, name);

      const resultBox = $('#restore-result');
      resultBox.innerHTML =
        `복원 완료: <strong>${escapeHtml(name)}</strong><br />복원된 항목 ${restoredCount}건`
        + (notRestoredCount > 0 ? ` · 복원 불가(마스킹·삭제 처리) ${notRestoredCount}건` : '');
      resultBox.hidden = false;
    } catch (err) {
      showError(err);
    }
  });
}
