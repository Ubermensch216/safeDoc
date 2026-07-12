// 치환 토큰 표시용 한글 서브셋 폰트 생성 (빌드 도구)
// 원본: Noto Sans KR Regular (SIL Open Font License 1.1)
// PDF 결과 파일에 치환 토큰([성명_001] 등)을 그리기 위한 최소 글리프만 포함한다.
//
// 사용법: node scripts/makeTokenFont.mjs <원본폰트경로>
// 출력: src/assets/tokenFont.js (base64 모듈)

import subsetFont from 'subset-font';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = process.argv[2];
if (!srcPath) {
  console.error('원본 폰트 경로를 지정하십시오.');
  process.exit(1);
}

// 포함할 문자: ASCII 인쇄 가능 문자 + 치환 토큰에 사용되는 한글
let chars = '';
for (let i = 0x20; i <= 0x7e; i++) chars += String.fromCharCode(i);
chars += '성명주민번호외국인휴대전화이메일주소계좌카드여권사업자차량생년월일개인정보삭제';

const original = readFileSync(srcPath);
const subset = await subsetFont(original, chars, { targetFormat: 'truetype' });

mkdirSync(resolve(root, 'src/assets'), { recursive: true });
const b64 = Buffer.from(subset).toString('base64');
const module_ = `// 자동 생성 파일 — scripts/makeTokenFont.mjs 로 재생성
// 원본: Noto Sans KR Regular (SIL Open Font License 1.1, https://fonts.google.com/noto)
// PDF 치환 토큰 표시용 서브셋 (한글 ${[...new Set(chars)].filter((c) => c > '\\u1000').length}자 + ASCII)
export const TOKEN_FONT_BASE64 = '${b64}';

export function tokenFontBytes() {
  const bin = atob(TOKEN_FONT_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
`;
writeFileSync(resolve(root, 'src/assets/tokenFont.js'), module_);
console.log(`서브셋 폰트 생성 완료: ${subset.length} bytes → src/assets/tokenFont.js (base64 ${b64.length}자)`);
