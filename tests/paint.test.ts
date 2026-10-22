import { expect, test } from 'claude-code/testing'
import { MAX, MIN, PALETTE, SIZE, STEP, crop, decode, parseLang, parseSize, stepSize, toAscii, toCode, toSvg } from '../hooks/register'

test('저장: 숫자열을 팔레트 번호로 읽고, 틀린 건 거절한다', () => {
  expect(decode('0120', 2, 2)).toEqual([0, 1, 2, 0])
  expect(decode('012', 2, 2)).toBeNull() // wrong length
  expect(decode('01a0', 2, 2)).toBeNull() // not digits
  expect(decode(42, 2, 2)).toBeNull()
})

test('SVG: 같은 색이 이어진 칸은 사각형 하나', () => {
  const svg = toSvg([1, 1, 0, 2], 4, 1, 10)
  expect(svg).toContain(`<rect x="0" y="0" width="20" height="10" fill="${PALETTE[1]}"/>`)
  expect(svg).toContain(`<rect x="30" y="0" width="10" height="10" fill="${PALETTE[2]}"/>`)
  expect(svg.match(/<rect x=/g)).toHaveLength(2)
})

test('크기: x, *, ×, 공백을 모두 받고, 세로는 짝수로, 범위 밖은 한계로 맞추며 알린다', () => {
  expect(parseSize('100x60')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize('100*60')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize('100 × 60')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize('100 60')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize(' 100 * 60 ')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize('100X60')).toEqual({ w: 100, ph: 60, adjusted: false })
  expect(parseSize('100 61')).toEqual({ w: 100, ph: 60, adjusted: true }) // odd height made even
  expect(parseSize('999*1')).toEqual({ w: 160, ph: 12, adjusted: true })
  expect(parseSize('24x12')).toEqual({ w: 24, ph: 12, adjusted: false }) // the smallest
  expect(parseSize('160x100')).toEqual({ w: 160, ph: 100, adjusted: false }) // the biggest
  expect(parseSize('23x12')?.w).toBe(24)
  expect(parseSize('161x100')?.w).toBe(160)
  expect(parseSize('24x11')?.ph).toBe(12)
  expect(parseSize('24x101')?.ph).toBe(100)
  expect(parseSize('100**60')).toBeNull()
  expect(parseSize('100')).toBeNull()
  expect(parseSize('big')).toBeNull()
  expect([MIN, MAX]).toEqual([{ w: 24, ph: 12 }, { w: 160, ph: 100 }])
})

test('크기 단계: 기본은 32×32, +/−는 가로·세로를 같이 STEP씩 바꾼다', () => {
  expect(SIZE).toEqual({ w: 32, ph: 32 })
  expect(STEP).toBe(8)
  expect(stepSize({ w: 32, ph: 32 }, 1)).toEqual({ w: 40, ph: 40 }) // square stays square
  expect(stepSize({ w: 40, ph: 40 }, 1)).toEqual({ w: 48, ph: 48 })
  expect(stepSize({ w: 32, ph: 32 }, -1)).toEqual({ w: 24, ph: 24 })
})

test('크기 단계: 한쪽이 끝에 닿으면 나머지 한쪽만 움직인다 (키울 때)', () => {
  // the height limit (100) comes first on a wide terminal: then only the width grows
  expect(stepSize({ w: 96, ph: 96 }, 1)).toEqual({ w: 104, ph: 100 })
  expect(stepSize({ w: 104, ph: 100 }, 1)).toEqual({ w: 112, ph: 100 })
  expect(stepSize({ w: 152, ph: 100 }, 1)).toEqual({ w: 160, ph: 100 })
  expect(stepSize({ w: 160, ph: 100 }, 1)).toEqual({ w: 160, ph: 100 }) // both at the limit: stays
  // a narrow terminal: the width stops at the columns the pane has, then only the height grows
  const cols = 80
  expect(stepSize({ w: 72, ph: 72 }, 1, cols)).toEqual({ w: 80, ph: 80 })
  expect(stepSize({ w: 80, ph: 80 }, 1, cols)).toEqual({ w: 80, ph: 88 })
  expect(stepSize({ w: 80, ph: 88 }, 1, cols)).toEqual({ w: 80, ph: 96 })
  expect(stepSize({ w: 80, ph: 96 }, 1, cols)).toEqual({ w: 80, ph: 100 })
  expect(stepSize({ w: 80, ph: 100 }, 1, cols)).toEqual({ w: 80, ph: 100 })
})

test('크기 단계: 줄일 때도 한쪽이 최소에 닿으면 나머지만 줄어든다', () => {
  expect(stepSize({ w: 24, ph: 24 }, -1)).toEqual({ w: 24, ph: 16 })
  expect(stepSize({ w: 24, ph: 16 }, -1)).toEqual({ w: 24, ph: 12 })
  expect(stepSize({ w: 24, ph: 12 }, -1)).toEqual({ w: 24, ph: 12 }) // the smallest stays
  expect(stepSize({ w: 100, ph: 60 }, -1)).toEqual({ w: 92, ph: 52 })
})

test('크기 단계: 한계 밖의 크기를 거꾸로 움직이지 않는다', () => {
  // a width typed wider than the terminal is not pulled back by +, and a height at its limit is not either
  expect(stepSize({ w: 150, ph: 60 }, 1, 100)).toEqual({ w: 150, ph: 68 })
  expect(stepSize({ w: 100, ph: 60 }, 1)).toEqual({ w: 108, ph: 68 }) // a typed size just steps
  expect(stepSize({ w: 30, ph: 100 }, 1, 20)).toEqual({ w: 30, ph: 100 }) // a cap below MIN is read as MIN
})

const sprite = () => {
  // 8 wide, 4 tall; a plane-ish shape at columns 2..4, rows 1..3 (W white nose, B blue wings, O orange engine)
  const g = Array<number>(8 * 4).fill(0)
  for (const [x, y, c] of [[3, 1, 8], [2, 2, 5], [3, 2, 5], [4, 2, 5], [3, 3, 2]] as const) g[y * 8 + x] = c
  return g
}

test('내보내기: 그린 부분만 잘라 낸다 (빈 그림은 null)', () => {
  expect(crop(sprite(), 8, 4)).toEqual([[0, 8, 0], [5, 5, 5], [0, 2, 0]])
  expect(crop(Array(32).fill(0), 8, 4)).toBeNull()
  expect(toCode(Array(32).fill(0), 8, 4)).toBeNull()
  expect(toAscii(Array(32).fill(0), 8, 4)).toBeNull()
})

test('내보내기: JS 코드는 배열과 쓴 색만 담는다', () => {
  const code = toCode(sprite(), 8, 4)!
  expect(code).toContain('const SPRITE = [\n  ".W.",\n  "BBB",\n  ".O.",\n]')
  expect(code).toContain(`W: '${PALETTE[8]}'`)
  expect(code).toContain(`B: '${PALETTE[5]}'`)
  expect(code).not.toContain('R:')
})

test('내보내기: ASCII는 한 픽셀이 두 글자이고 밝을수록 진하다', () => {
  const lines = toAscii(sprite(), 8, 4)!.split('\n')
  expect(lines[0]).toBe('  ██') // white: the densest, two characters, blank to its left
  expect(lines[1]).toBe('▓▓▓▓▓▓') // sky blue: fairly bright
  expect(lines[2]).toBe('  ▒▒') // orange
})

test('언어: 영문/한글 이름을 알아본다', () => {
  expect(parseLang('en')).toBe('en')
  expect(parseLang(' English ')).toBe('en')
  expect(parseLang('영문')).toBe('en')
  expect(parseLang('ko')).toBe('ko')
  expect(parseLang('한국어')).toBe('ko')
  expect(parseLang('fr')).toBeNull()
  expect(parseLang('')).toBeNull()
})

test('내보내기 코드의 주석은 언어를 따른다', () => {
  const g = sprite()
  expect(toCode(g, 8, 4, 'en')).toContain("// 3x3 · '.' = clear · O orange · B blue · W white")
  expect(toCode(g, 8, 4, 'ko')).toContain("// 3x3 · '.' = 비어 있음 · O 주황 · B 파랑 · W 흰색")
  expect(toCode(g, 8, 4)).toBe(toCode(g, 8, 4, 'ko')) // Korean is the default
})
