// The paint canvas, drawn and driven on the surface: pointer down / move / up draw as the
// mouse is dragged (a line is filled between two moves), keys pick colors and tools.
//   Layout (cells, region-relative):  row 0 palette · row 1 tools · row 2 file · row 3 mirror · rows 4.. canvas · status row · help
//   The canvas is pixels, two to a character with a half block (▀: top pixel as the color,
//   bottom pixel as the background), 1 pixel per column.
// A surface module runs apart from the hooks module, so it holds its own palette; a test
// checks it matches register.ts. `h` and `Fragment` are the environment's: no variable takes them.
import type { ClientPointerEvent } from 'claude-code'

type Lang = 'ko' | 'en'
type Props = { w?: number; ph?: number; note?: string; lang?: Lang; help?: boolean; picker?: boolean; debug?: boolean; palette?: unknown }
type Tool = 'pen' | 'line' | 'fill'
type Mirror = 'off' | 'lr' | 'ud' | 'both' // lr: left-right, ud: up-down
type Store = {
  w: number // pixels wide
  ph: number // pixels high, even
  grid: number[] // palette index per pixel, row-major; 0 = empty
  color: number
  tool: Tool
  brush: number
  undo: number[][]
  redo: number[][] // grids undone, newest last; any new stroke empties it
  last: { x: number; y: number } | null
  start: { x: number; y: number } | null // where the stroke began (for straight lines)
  base: number[] | null // the canvas as the stroke began, redrawn under a line that follows the pointer
  erasing: boolean
  note: string
  noteFrom: string
  lang: Lang
  help: boolean // the help block under the canvas is shown
  picker: boolean // the color picker under the canvas is shown
  debug: boolean // /paint debug: the status line shows the last key and pointer event that arrived
  seen: { keys: number; pointers: number; key: string; pointer: string }
  mirror: Mirror // strokes, lines and fills are repeated across the middle
  palette: string[] // the ten colors, from the hooks module's props; index 0 is the eraser
}

const PALETTE = ['', '#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#8b5cf6', '#ec4899', '#ffffff', '#000000']
const PICKER_ROWS = 6 // the picker: a heading, four rows of colors and a row of reset chips; the hooks module sizes the region by this
const PICKER_COLS = 16
const PICKER_CELL = 4 // columns per color in the picker

// The colors the picker offers: sixteen hues in a light, a medium and a dark shade, then sixteen grays (white to black).
const HUES: [string, string, string][] = [
  ['#fca5a5', '#ef4444', '#991b1b'], ['#fdba74', '#f97316', '#9a3412'], ['#fcd34d', '#f59e0b', '#92400e'], ['#fde047', '#eab308', '#854d0e'],
  ['#bef264', '#84cc16', '#3f6212'], ['#86efac', '#22c55e', '#166534'], ['#6ee7b7', '#10b981', '#065f46'], ['#5eead4', '#14b8a6', '#115e59'],
  ['#67e8f9', '#06b6d4', '#155e75'], ['#7dd3fc', '#0ea5e9', '#075985'], ['#93c5fd', '#3b82f6', '#1e40af'], ['#a5b4fc', '#6366f1', '#3730a3'],
  ['#c4b5fd', '#8b5cf6', '#5b21b6'], ['#d8b4fe', '#a855f7', '#6b21a8'], ['#f9a8d4', '#ec4899', '#9d174d'], ['#fda4af', '#f43f5e', '#9f1239'],
]
const GRAYS = Array.from({ length: PICKER_COLS }, (_, i) => '#' + Math.round(255 * (1 - i / (PICKER_COLS - 1))).toString(16).padStart(2, '0').repeat(3))
const PICKER_COLORS: string[][] = [HUES.map(h => h[0]), HUES.map(h => h[1]), HUES.map(h => h[2]), GRAYS]

/** The palette from props when it is ten colors (index 0 empty, 1-9 as #rrggbb); the default one otherwise. */
function validPalette(p: unknown): string[] {
  if (!Array.isArray(p) || p.length !== 10) return [...PALETTE]
  return p.every((c, i) => (i === 0 ? c === '' : typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) ? [...(p as string[])] : [...PALETTE]
}

/** WCAG relative luminance of a #rrggbb color, 0 (black) .. 1 (white). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

/** Black or white text, whichever has the better contrast on this color (the defaults keep black, but on black itself). */
function textOn(hex: string): string {
  const l = luminance(hex)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff'
}

const EMPTY = '#202020'
const EMPTY_AXIS = '#2e3d49' // empty pixels on a mirror axis, so the line of symmetry shows
// Menu colors: tools light up green when chosen, file actions are blue, Clear is red, the language chip purple.
const UI = {
  chip: '#2f343c', chipText: '#d5d9df',
  on: '#1db954', onText: '#04210e',
  action: '#1d3b52', actionText: '#a9dcff',
  danger: '#4a2328', dangerText: '#ffb3ba',
  lang: '#3b3350', langText: '#dccdff',
  off: '#23262c', offText: '#6b7280',
}
const SEP = ' │ ' // between groups of chips (3 columns)
const TOP = 4 // rows above the canvas
const UNDO_LIMIT = 20
const PALETTE_CHIP = 4 // columns per palette chip
// The size limits, in pixels: the hooks module holds the same numbers (a test compares them).
const LIMITS = { minW: 24, maxW: 160, minPh: 12, maxPh: 100 }
const HELP_ROWS = 10 // the heading and nine lines; the hooks module sizes the region by this
const SWATCHES_END = 10 * PALETTE_CHIP // row 0: the 10 swatches take columns 0-39, then a separator, then the size group

const even = (n: number) => n - (n % 2)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Terminal columns a string takes: Hangul and CJK count 2. */
function cols(text: string): number {
  let n = 0
  for (const ch of text) n += ch.codePointAt(0)! >= 0x1100 && /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1
  return n
}

// What the chips and the hint say, per language (the language is the hooks module's to set).
const TEXT = {
  ko: {
    pen: ' ✎ 펜 ', line: ' ╱ 직선 ', fill: ' ▨ 채우기 ', brush: (n: number) => ` ● 굵기 ${n} `, undo: ' ↶ 되돌리기 ', redo: ' ↷ 다시 ', clear: ' ✕ 지우기 ', save: ' ⤓ 저장 ',
    js: ' JS 코드 복사 ', ascii: ' ASCII 복사 ', lang: ' English ',
    hint: '드래그해서 그리기 · ? 도움말 · l 직선 · z 되돌리기 · [ ] 크기',
    helpTitle: '도움말',
    help: [
      ['그리기', '왼쪽 버튼 드래그 = 그리기, 오른쪽 버튼 = 지우기'],
      ['도구', 'p 펜 · l 직선 · f 채우기 · b 굵기 바꾸기 (1-4)'],
      ['대칭', 'm 키로 좌우 · 상하 · 4방향 · 끔 (반대쪽에도 찍혀요)'],
      ['직선', 'l 직선 도구, 또는 Shift 누르고 드래그 (가로·세로·45°)'],
      ['색', '1-9 색 · 0 지우개 · k 팔레트 · r 초기화 · R 전부 초기화'],
      ['되돌리기', 'z 되돌리기 · x 다시 · Ctrl+Z 는 Claude Code 를 멈춰요!'],
      ['크기', `[ ] 또는 − + 칩, 아래 입력칸 (가로 ${LIMITS.minW}-${LIMITS.maxW}, 세로 ${LIMITS.minPh}-${LIMITS.maxPh})`],
      ['내보내기', 'e SVG 저장 · j JS 코드 복사 · a ASCII 복사 · c 지우기'],
      ['참고', '키는 캔버스를 한 번 클릭해야 먹어요 · ? 로 접기'],
    ],
    tools: { pen: '펜', line: '직선', fill: '채우기' },
    pickerChip: ' ◐ 색 편집 ',
    pickerDefault: (n: number, hex: string) => `색 ${n} 기본값: ${hex}`,
    pickerNoDefault: '(지우개는 색이 없어요)',
    resetOne: ' ↺ 이 색 초기화 ',
    resetAll: ' ↺ 모두 초기화 ',
    pickerHead: (n: number, hex: string) => `색 ${n} 을(를) 바꿔요 · 아래에서 고르세요 (지금 ${hex})`,
    pickerEraser: '먼저 1-9번 색을 고르세요 (0은 지우개라 바꿀 수 없어요)',
    mirrorLabel: '대칭', mirrorChips: { off: ' 끔 ', lr: ' ↔ 좌우 ', ud: ' ↕ 상하 ', both: ' ✛ 4방향 ' },
    mirrorName: { off: '끔', lr: '좌우', ud: '상하', both: '4방향' },
    status: (tool: string, brush: number, color: string, undo: number, redo: number, mirror: string) => `${tool} · 굵기 ${brush} · 색 ${color}${mirror ? ` · 대칭 ${mirror}` : ''} · ↶ ${undo} · ↷ ${redo}`,
  },
  en: {
    pen: ' ✎ Pen ', line: ' ╱ Line ', fill: ' ▨ Fill ', brush: (n: number) => ` ● Brush ${n} `, undo: ' ↶ Undo ', redo: ' ↷ Redo ', clear: ' ✕ Clear ', save: ' ⤓ Save ',
    js: ' Copy JS ', ascii: ' Copy ASCII ', lang: ' 한국어 ',
    hint: 'Drag to draw · ? help · l line · z undo · [ ] size',
    helpTitle: 'Help',
    help: [
      ['Draw', 'Left-button drag draws, right-button drag erases'],
      ['Tools', 'p pen · l line · f fill · b brush size (1-4)'],
      ['Mirror', 'm cycles left-right / up-down / both / off'],
      ['Line', 'l line tool, or hold Shift while dragging (0/45/90°)'],
      ['Colors', '1-9 pick · 0 eraser · k picker · r reset · R reset all'],
      ['Undo', 'z undo · x redo · Ctrl+Z suspends Claude Code!'],
      ['Size', `[ ] or − +, or the field below (w ${LIMITS.minW}-${LIMITS.maxW} · h ${LIMITS.minPh}-${LIMITS.maxPh})`],
      ['Output', 'e save SVG · j copy JS code · a copy ASCII · c clear'],
      ['Note', 'Click the canvas once so keys work · ? folds help'],
    ],
    tools: { pen: 'Pen', line: 'Line', fill: 'Fill' },
    pickerChip: ' ◐ Edit color ',
    pickerDefault: (n: number, hex: string) => `Default for color ${n}: ${hex}`,
    pickerNoDefault: '(the eraser has no color)',
    resetOne: ' ↺ Reset this color ',
    resetAll: ' ↺ Reset all ',
    pickerHead: (n: number, hex: string) => `Click a color to use as color ${n} (now ${hex})`,
    pickerEraser: 'Pick color 1-9 first (0 is the eraser and cannot change)',
    mirrorLabel: 'Mirror', mirrorChips: { off: ' Off ', lr: ' ↔ Left-right ', ud: ' ↕ Up-down ', both: ' ✛ Both ' },
    mirrorName: { off: 'off', lr: 'left-right', ud: 'up-down', both: 'both' },
    status: (tool: string, brush: number, color: string, undo: number, redo: number, mirror: string) => `${tool} · Brush ${brush} · Color ${color}${mirror ? ` · Mirror ${mirror}` : ''} · ↶ ${undo} · ↷ ${redo}`,
  },
} as const

type Kind = 'plain' | 'tool' | 'action' | 'danger' | 'lang' | 'label' | 'off' // off: a chip with nothing to do right now
type Chip = { id: string; label: string; kind: Kind; on?: boolean }

// The two chip rows as groups: a separator sits between groups, one space between chips in a group.
const rowTools = (s: Store): Chip[][] => [
  [
    { id: 'pen', label: TEXT[s.lang].pen, kind: 'tool', on: s.tool === 'pen' },
    { id: 'line', label: TEXT[s.lang].line, kind: 'tool', on: s.tool === 'line' },
    { id: 'fill', label: TEXT[s.lang].fill, kind: 'tool', on: s.tool === 'fill' },
  ],
  [{ id: 'brush', label: TEXT[s.lang].brush(s.brush), kind: 'plain' }],
  [
    { id: 'undo', label: TEXT[s.lang].undo, kind: 'plain' },
    { id: 'redo', label: TEXT[s.lang].redo, kind: 'plain' },
  ],
]

const rowFile = (s: Store): Chip[][] => [
  [
    { id: 'save', label: TEXT[s.lang].save, kind: 'action' },
    { id: 'js', label: TEXT[s.lang].js, kind: 'action' },
    { id: 'ascii', label: TEXT[s.lang].ascii, kind: 'action' },
  ],
  [{ id: 'clear', label: TEXT[s.lang].clear, kind: 'danger' }],
  [{ id: 'lang', label: TEXT[s.lang].lang, kind: 'lang' }],
]

// Row 3: the mirror modes, one of them lit (a dim word in front says what the row is), and the color picker's switch.
const rowMirror = (s: Store): Chip[][] => [
  [
    { id: 'label', label: TEXT[s.lang].mirrorLabel, kind: 'label' },
    ...(['off', 'lr', 'ud', 'both'] as const).map(m => ({ id: `mirror-${m}`, label: TEXT[s.lang].mirrorChips[m], kind: 'tool' as const, on: s.mirror === m })),
  ],
  [{ id: 'picker', label: TEXT[s.lang].pickerChip, kind: 'tool', on: s.picker }],
]

/** True when the swatch (or, with `index` null, any swatch) is not its default color. */
const isCustom = (s: Store, index: number | null) => (index === null ? s.palette.some((c, i) => c !== PALETTE[i]) : index >= 1 && s.palette[index] !== PALETTE[index])

// The picker's last row: the default of the chosen swatch, and chips to take back that swatch's color or all of them.
// A chip that would change nothing is drawn dim and does nothing.
const rowReset = (s: Store): Chip[][] => [
  [
    { id: 'label', label: s.color === 0 ? TEXT[s.lang].pickerNoDefault : TEXT[s.lang].pickerDefault(s.color, PALETTE[s.color]!), kind: 'label' },
    { id: 'reset-one', label: TEXT[s.lang].resetOne, kind: isCustom(s, s.color) ? 'plain' : 'off' },
    { id: 'reset-all', label: TEXT[s.lang].resetAll, kind: isCustom(s, null) ? 'plain' : 'off' },
  ],
]

/** Where each chip of a row starts and ends (columns). */
function layout(groups: Chip[][]) {
  const out: (Chip & { from: number; to: number })[] = []
  let x = 0
  groups.forEach((group, gi) => {
    if (gi > 0) x += cols(SEP)
    group.forEach((chip, ci) => {
      if (ci > 0) x += 1
      out.push({ ...chip, from: x, to: x + cols(chip.label) })
      x += cols(chip.label)
    })
  })
  return out
}

/** Row 0 after the swatches: the − chip, the size, the + chip. */
function sizeSpans(s: Store) {
  const label = ` ${s.w}×${s.ph} `
  const start = SWATCHES_END + cols(SEP)
  return {
    label,
    smaller: { from: start, to: start + 3 },
    bigger: { from: start + 3 + cols(label), to: start + 3 + cols(label) + 3 },
    help: { from: start + 3 + cols(label) + 3 + cols(SEP), to: start + 3 + cols(label) + 3 + cols(SEP) + 3 },
  }
}

/** A canvas of another size: what fits of the drawing stays at the top left. Undo steps no longer fit, so they go. */
function reset(s: Store, w: number, ph: number) {
  const grid = Array<number>(w * ph).fill(0)
  for (let y = 0; y < Math.min(ph, s.ph); y++)
    for (let x = 0; x < Math.min(w, s.w); x++) grid[y * w + x] = s.grid[y * s.w + x] ?? 0
  s.w = w
  s.ph = ph
  s.grid = grid
  s.undo = []
  s.redo = []
  s.last = null
}

/** Every pixel on the line from a to b (Bresenham). */
function line(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  let x = a.x
  let y = a.y
  const dx = Math.abs(b.x - a.x)
  const dy = -Math.abs(b.y - a.y)
  const sx = a.x < b.x ? 1 : -1
  const sy = a.y < b.y ? 1 : -1
  let err = dx + dy
  for (let i = 0; i < 10_000; i++) {
    out.push({ x, y })
    if (x === b.x && y === b.y) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
  return out
}

/** `to` moved to the nearest horizontal, vertical or 45° line through `from` (what Shift does in most paint programs). */
function snap(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx > 2 * ady) return { x: to.x, y: from.y }
  if (ady > 2 * adx) return { x: from.x, y: to.y }
  const m = Math.round((adx + ady) / 2)
  return { x: from.x + Math.sign(dx) * m, y: from.y + Math.sign(dy) * m }
}

/** The points a point is repeated at by the mirror mode (not the point itself): across the middle, left-right and/or up-down. */
function mirrored(s: Store, x: number, y: number): { x: number; y: number }[] {
  const lr = s.mirror === 'lr' || s.mirror === 'both'
  const ud = s.mirror === 'ud' || s.mirror === 'both'
  const out: { x: number; y: number }[] = []
  if (lr) out.push({ x: s.w - 1 - x, y })
  if (ud) out.push({ x, y: s.ph - 1 - y })
  if (lr && ud) out.push({ x: s.w - 1 - x, y: s.ph - 1 - y })
  return out
}

/** One pixel in the current color, and its mirror images. */
function put(s: Store, x: number, y: number) {
  for (const q of [{ x, y }, ...mirrored(s, x, y)]) if (q.x >= 0 && q.x < s.w && q.y >= 0 && q.y < s.ph) s.grid[q.y * s.w + q.x] = s.color
}

function stamp(s: Store, at: { x: number; y: number }) {
  const r = Math.floor((s.brush - 1) / 2)
  // each pixel of the brush is mirrored itself, so an even brush mirrors exactly
  for (let dy = 0; dy < s.brush; dy++) for (let dx = 0; dx < s.brush; dx++) put(s, at.x - r + dx, at.y - r + dy)
}

function fill(s: Store, at: { x: number; y: number }) {
  const start = at.y * s.w + at.x
  const from = s.grid[start]
  if (from === undefined || from === s.color) return
  const stack = [start]
  while (stack.length) {
    const i = stack.pop()!
    if (s.grid[i] !== from) continue
    s.grid[i] = s.color
    const x = i % s.w
    if (x > 0) stack.push(i - 1)
    if (x < s.w - 1) stack.push(i + 1)
    if (i >= s.w) stack.push(i - s.w)
    if (i < s.w * (s.ph - 1)) stack.push(i + s.w)
  }
}

/** Fill from a point and from each of its mirror images (a region already filled is skipped: its color is now the new one). */
function fillAll(s: Store, at: { x: number; y: number }) {
  for (const q of [at, ...mirrored(s, at.x, at.y)]) if (q.x >= 0 && q.x < s.w && q.y >= 0 && q.y < s.ph) fill(s, q)
}

function pushUndo(s: Store) {
  s.redo = [] // a new change ends the way forward
  s.undo.push(s.grid.slice())
  if (s.undo.length > UNDO_LIMIT) s.undo.shift()
}

export default function Paint(props: Props, surface: any) {
  const w = clamp(Math.round(props?.w ?? 32), LIMITS.minW, LIMITS.maxW)
  const ph = even(clamp(Math.round(props?.ph ?? 32), LIMITS.minPh, LIMITS.maxPh))

  if (surface.state === undefined) {
    const s: Store = { w, ph, grid: [], color: 1, tool: 'pen', brush: 1, undo: [], redo: [], last: null, start: null, base: null, erasing: false, note: '', noteFrom: '', lang: props?.lang === 'en' ? 'en' : 'ko', help: props?.help !== false, picker: props?.picker === true, debug: props?.debug === true, seen: { keys: 0, pointers: 0, key: '-', pointer: '-' }, mirror: 'off', palette: validPalette(props?.palette) }
    reset(s, w, ph)
    let tick = 0
    // the state is a handle on the store the listeners below mutate; a new object asks for a redraw
    const redraw = () => surface.setState({ store: s, tick: ++tick })
    // Choosing a color tells the hooks module, so a bare entry in its Color field changes the swatch you picked
    const choose = (i: number) => {
      if (i === s.color) return
      s.color = i
      surface.post({ select: i, w: s.w, ph: s.ph })
    }
    const pixel = (e: ClientPointerEvent) => {
      const fx = e.fine?.x ?? e.x + 0.5
      const fy = e.fine?.y ?? e.y + 0.25 // no sub-cell position: the top pixel of the cell
      return { x: Math.floor(fx), y: Math.floor((fy - TOP) * 2) }
    }
    const act = (id: string) => {
      if (id === 'pen' || id === 'line' || id === 'fill') s.tool = id
      else if (id === 'brush') s.brush = (s.brush % 4) + 1
      else if (id === 'undo') {
        const prev = s.undo.pop()
        if (prev) {
          s.redo.push(s.grid)
          s.grid = prev
        }
      } else if (id === 'redo') {
        const next = s.redo.pop()
        if (next) {
          s.undo.push(s.grid)
          s.grid = next
        }
      } else if (id === 'clear') {
        pushUndo(s)
        s.grid = Array<number>(s.w * s.ph).fill(0)
      } else if (id === 'save') {
        surface.post({ save: s.grid.join(''), w: s.w, ph: s.ph })
      } else if (id === 'mirror') {
        s.mirror = s.mirror === 'off' ? 'lr' : s.mirror === 'lr' ? 'ud' : s.mirror === 'ud' ? 'both' : 'off'
      } else if (id.startsWith('mirror-')) {
        s.mirror = id.slice('mirror-'.length) as Mirror
      } else if (id === 'reset-one') {
        if (isCustom(s, s.color)) surface.post({ resetColor: s.color, w: s.w, ph: s.ph })
      } else if (id === 'reset-all') {
        if (isCustom(s, null)) surface.post({ resetColor: 'all', w: s.w, ph: s.ph })
      } else if (id === 'picker') {
        // the region's height depends on it, and that is the hooks module's to set
        surface.post({ picker: !s.picker, w: s.w, ph: s.ph })
      } else if (id === 'help') {
        // the region's height depends on it, and that is the hooks module's to set
        surface.post({ help: !s.help, w: s.w, ph: s.ph })
      } else if (id === 'lang') {
        surface.post({ lang: s.lang === 'ko' ? 'en' : 'ko', w: s.w, ph: s.ph })
      } else if (id === 'js' || id === 'ascii') {
        surface.post({ export: id, grid: s.grid.join(''), w: s.w, ph: s.ph })
      } else if (id === 'smaller' || id === 'bigger') {
        // the region's size is the hooks module's to change: ask, and the next props carry the answer
        surface.post({ resize: id === 'bigger' ? 1 : -1, w: s.w, ph: s.ph })
      }
      redraw()
    }

    surface.onPointer((e: ClientPointerEvent) => {
      if (s.debug && e.type !== 'move' && e.type !== 'enter' && e.type !== 'leave') {
        // what arrived (moves are left out: they come by the dozen)
        s.seen.pointers += 1
        s.seen.pointer = `${e.type}${e.button ? ' ' + e.button : ''} ${e.x},${e.y}${e.shift ? ' shift' : ''}`
        redraw()
      }
      if (e.type === 'down') s.note = '' // a note (saved, copied...) stays until the next thing you do
      if (e.type === 'up' || e.type === 'leave') {
        s.last = null
        s.start = null
        s.base = null
        return
      }
      if (e.type === 'down' && e.button === 'left' && e.y < TOP) {
        const x = Math.floor(e.fine?.x ?? e.x)
        if (e.y === 0) {
          const i = Math.floor(x / PALETTE_CHIP)
          const size = sizeSpans(s)
          if (x >= 0 && x < SWATCHES_END) {
            if (i === s.color && i !== 0) act('picker') // clicking the chosen swatch again edits it
            else { choose(i); redraw() }
          }
          else if (x >= size.smaller.from && x < size.smaller.to) act('smaller')
          else if (x >= size.bigger.from && x < size.bigger.to) act('bigger')
          else if (x >= size.help.from && x < size.help.to) act('help')
        } else {
          const hit = layout(e.y === 1 ? rowTools(s) : e.y === 2 ? rowFile(s) : rowMirror(s)).find(t => t.id !== 'label' && x >= t.from && x < t.to)
          if (hit) act(hit.id)
        }
        return
      }
      // a click in the picker under the canvas: that color goes to the chosen swatch
      const pickerTop = TOP + s.ph / 2 + 2 // the canvas, the status row, the picker's heading
      if (s.picker && e.type === 'down' && e.button === 'left' && e.y >= pickerTop && e.y < pickerTop + PICKER_ROWS - 1) {
        if (e.y === pickerTop + PICKER_COLORS.length) {
          // the reset row
          const x = Math.floor(e.fine?.x ?? e.x)
          const hit = layout(rowReset(s)).find(c => c.id !== 'label' && x >= c.from && x < c.to)
          if (hit) act(hit.id)
          return
        }
        const col = Math.floor((e.fine?.x ?? e.x) / PICKER_CELL)
        const hex = col >= 0 && col < PICKER_COLS ? PICKER_COLORS[e.y - pickerTop]?.[col] : undefined
        if (hex && s.color !== 0) surface.post({ setColor: { index: s.color, hex }, w: s.w, ph: s.ph })
        return
      }
      if (e.button !== 'left' && e.button !== 'right') return
      if (e.type === 'down') {
        const p = pixel(e)
        if (p.y < 0 || p.x < 0 || p.x >= s.w || p.y >= s.ph) return
        pushUndo(s)
        const erase = e.button === 'right'
        const keep = s.color
        if (erase) s.color = 0
        if (s.tool === 'fill' && !erase) fillAll(s, p)
        else stamp(s, p)
        if (erase) s.color = keep
        s.last = s.tool === 'fill' && !erase ? null : p
        s.start = s.last
        s.base = s.last ? s.grid.slice() : null // with the first dot already on it
        // right button erases: remember which, so the drag keeps erasing
        s.erasing = erase
        redraw()
      } else if (e.type === 'move' && s.last) {
        const p = { x: clamp(pixel(e).x, 0, s.w - 1), y: clamp(pixel(e).y, 0, s.ph - 1) }
        const keep = s.color
        if (s.erasing) s.color = 0
        if (s.start && s.base && (s.tool === 'line' || e.shift)) {
          // a straight line from where the stroke began to the pointer, redrawn as it moves;
          // Shift (when the terminal reports it) snaps it to horizontal, vertical or 45°
          s.grid = s.base.slice()
          const end = e.shift ? snap(s.start, p) : p
          for (const q of line(s.start, end)) stamp(s, q)
          s.last = end
        } else {
          for (const q of line(s.last, p)) stamp(s, q)
          // freehand: a straight line begun now (Shift pressed mid-stroke) starts from here
          s.start = p
          s.base = s.grid.slice()
          s.last = p
        }
        s.color = keep
        redraw()
      }
    })

    surface.onKey((incoming: { key: string; ctrl?: true; meta?: true; shift?: true }) => {
      if (s.debug) {
        s.seen.keys += 1
        s.seen.key = JSON.stringify(incoming)
        redraw()
      }
      s.note = ''
      // A terminal can send Ctrl+letter as the control character itself (Ctrl+Y is 0x19): read it as Ctrl+y. Ctrl+_ is 0x1F.
      const code = typeof incoming.key === 'string' && incoming.key.length === 1 ? incoming.key.charCodeAt(0) : 0
      const e = code >= 1 && code <= 26 && code !== 9 && code !== 10 && code !== 13 ? { ...incoming, key: String.fromCharCode(code + 96), ctrl: true as const }
        : code === 31 ? { ...incoming, key: '_', ctrl: true as const }
        : incoming
      if (!e.ctrl && !e.meta && e.key === 'R') { act('reset-all'); return } // Shift+R: every color back to its default
      const k = e.key.toLowerCase()
      if (e.ctrl || e.meta) {
        // Ctrl+_ (and Ctrl+/, the same key on many terminals) undoes, which is also what Claude Code uses in its own input;
        // Ctrl+Y redoes. Ctrl+Z never gets here on macOS or Linux: Claude Code takes it to suspend itself (and the key is
        // still handled in case a terminal does pass it on). Nothing else with a modifier.
        if (k === 'z' || k === '_' || k === '/') act(e.shift && k === 'z' ? 'redo' : 'undo')
        else if (k === 'y') act('redo')
        return
      }
      if (/^[0-9]$/.test(k)) { choose(Number(k)); redraw() }
      else if (k === 'p') act('pen')
      else if (k === 'l') act('line')
      else if (k === 'f') act('fill')
      else if (k === 'm') act('mirror')
      else if (k === 'b') act('brush')
      else if (k === 'z') act(e.shift ? 'redo' : 'undo') // z undoes, x (or Shift+Z) redoes
      else if (k === 'x') act('redo')
      else if (k === 'c') act('clear')
      else if (k === 'e') act('save')
      else if (k === 'j') act('js')
      else if (k === 'a') act('ascii')
      else if (k === '?' || k === 'h') act('help')
      else if (k === 'k') act('picker')
      else if (k === 'r') act('reset-one')
      else if (k === '[') act('smaller')
      else if (k === ']') act('bigger')
    })
    redraw()
  }

  const s: Store = (surface.state as { store: Store }).store
  s.lang = props?.lang === 'en' ? 'en' : 'ko'
  s.help = props?.help !== false
  s.picker = props?.picker === true
  s.debug = props?.debug === true
  s.palette = validPalette(props?.palette)
  if (s.w !== w || s.ph !== ph) reset(s, w, ph)
  if (props?.note && props.note !== s.noteFrom) {
    s.noteFrom = props.note
    s.note = props.note
  }
  return view(s, surface)
}

/** The color of an empty pixel: a little lighter on the line(s) of symmetry while mirroring. */
function guide(s: Store, x: number, y: number): string {
  const lr = s.mirror === 'lr' || s.mirror === 'both'
  const ud = s.mirror === 'ud' || s.mirror === 'both'
  const onX = lr && (x === Math.floor((s.w - 1) / 2) || x === Math.ceil((s.w - 1) / 2))
  const onY = ud && (y === Math.floor((s.ph - 1) / 2) || y === Math.ceil((s.ph - 1) / 2))
  return onX || onY ? EMPTY_AXIS : EMPTY
}

function view(s: Store, surface: any) {
  const { Box, Text } = surface.elements

  const sep = () => Text({ dimColor: true, children: [SEP] })
  const style = (c: Chip) =>
    c.kind === 'tool' && c.on ? { backgroundColor: UI.on, color: UI.onText, bold: true }
    : c.kind === 'action' ? { backgroundColor: UI.action, color: UI.actionText }
    : c.kind === 'danger' ? { backgroundColor: UI.danger, color: UI.dangerText }
    : c.kind === 'lang' ? { backgroundColor: UI.lang, color: UI.langText }
    : c.kind === 'label' ? { dimColor: true }
    : c.kind === 'off' ? { backgroundColor: UI.off, color: UI.offText }
    : { backgroundColor: UI.chip, color: UI.chipText }
  const chipRow = (groups: Chip[][]) =>
    Text({
      children: groups.flatMap((group, gi) => [
        ...(gi > 0 ? [sep()] : []),
        ...group.flatMap((c, ci) => [...(ci > 0 ? [Text({ children: [' '] })] : []), Text({ ...style(c), children: [c.label] })]),
      ]),
    })

  // Row 0: the ten swatches (the chosen one carries a dot), then the size group.
  const swatches = s.palette.map((hex: string, i: number) =>
    Text({
      backgroundColor: i === 0 ? UI.chip : hex,
      color: i === 0 ? UI.chipText : textOn(hex),
      bold: s.color === i,
      children: [s.color === i ? ` ${i}● ` : ` ${i}  `],
    }),
  )
  const size = sizeSpans(s)
  const palette = Text({
    children: [
      ...swatches,
      sep(),
      Text({ backgroundColor: UI.chip, color: UI.chipText, children: [' − '] }),
      Text({ bold: true, children: [size.label] }),
      Text({ backgroundColor: UI.chip, color: UI.chipText, children: [' + '] }),
      sep(),
      Text(s.help ? { backgroundColor: UI.on, color: UI.onText, bold: true, children: [' ? '] } : { backgroundColor: UI.chip, color: UI.chipText, children: [' ? '] }),
    ],
  })
  const toolsRow = chipRow(rowTools(s))
  const exportRow = chipRow(rowFile(s))
  const mirrorRow = chipRow(rowMirror(s))

  const rows: unknown[] = []
  for (let r = 0; r < s.ph; r += 2) {
    const runs: { text: string; color?: string; bg: string }[] = []
    for (let x = 0; x < s.w; x++) {
      const top = s.grid[r * s.w + x] ?? 0
      const bottom = s.grid[(r + 1) * s.w + x] ?? 0
      const topColor = top ? s.palette[top]! : guide(s, x, r)
      const bottomColor = bottom ? s.palette[bottom]! : guide(s, x, r + 1)
      // two pixels in one character: the top one is the color of a half block, the bottom one its background
      const cell = topColor === bottomColor ? { text: ' ', bg: topColor } : { text: '▀', color: topColor, bg: bottomColor }
      const last = runs[runs.length - 1]
      if (last && last.color === (cell as any).color && last.bg === cell.bg) last.text += cell.text
      else runs.push({ ...cell } as any)
    }
    rows.push(Text({ children: runs.map(c => Text({ color: c.color, backgroundColor: c.bg, children: [c.text] })) }))
  }

  const t = TEXT[s.lang]
  const status = s.debug ? `debug · key ${s.seen.keys}: ${s.seen.key} · pointer ${s.seen.pointers}: ${s.seen.pointer}` : s.note || (s.help ? t.status(t.tools[s.tool], s.brush, s.color === 0 ? '0' : `${s.color} ${s.palette[s.color]}`, s.undo.length, s.redo.length, s.mirror === 'off' ? '' : t.mirrorName[s.mirror]) : t.hint)

  // The help block: a heading rule, then a label column and its text, one line each.
  const LABEL = 11
  // The picker: a line saying what a click does, then the colors, a mark on the one the chosen swatch has now.
  const current = s.palette[s.color]
  const pickerRows = !s.picker ? [] : [
    Text({ dimColor: true, wrap: 'truncate-end', children: [s.color === 0 ? t.pickerEraser : t.pickerHead(s.color, current!)] }),
    ...PICKER_COLORS.map((row: string[]) =>
      Text({ children: row.map((hex: string) => Text({ backgroundColor: hex, color: textOn(hex), bold: true, children: [hex === current && s.color !== 0 ? ' ●  ' : '    '] })) }),
    ),
    chipRow(rowReset(s)),
  ]

  const helpRows = !s.help ? [] : [
    Text({ dimColor: true, wrap: 'truncate-end', children: [`── ${t.helpTitle} `.padEnd(1) + '─'.repeat(Math.max(2, 64 - cols(`── ${t.helpTitle} `)))] }),
    ...t.help.map(([label, text]: readonly [string, string]) =>
      Text({
        wrap: 'truncate-end',
        children: [Text({ color: UI.actionText, bold: true, children: [label + ' '.repeat(Math.max(1, LABEL - cols(label)))] }), Text({ dimColor: true, children: [text] })],
      }),
    ),
  ]

  return Box({
    flexDirection: 'column',
    children: [palette, toolsRow, exportRow, mirrorRow, ...rows, Text({ dimColor: !s.note, bold: !!s.note, wrap: 'truncate-end', children: [status] }), ...pickerRows, ...helpRows],
  })
}
