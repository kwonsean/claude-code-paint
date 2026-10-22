// Paint: /paint opens a pane with a canvas you draw on by dragging the mouse.
//   The canvas is a surface module (canvas.ts): it takes the pointer and keys on the surface and
//   draws itself. This hooks module opens the pane, hosts the module, and acts on what the canvas
//   posts: saves, exports, resize and language requests. Under the canvas sits a size field.
//   Two languages, Korean (the default) and English: /paint en, /paint ko, or the chip on the canvas.
import type { Register } from 'claude-code'

const PANE = 'paint'
export const SIZE = { w: 32, ph: 32 } // the size a new canvas starts at
// The canvas size limits, in pixels. The height is made even (two pixels share a character row).
export const MIN = { w: 24, ph: 12 }
export const MAX = { w: 160, ph: 100 }
const MENU_WIDTH = 66 // columns the menu rows need: the region is never narrower, whatever the canvas

// The colors of canvas.ts (a surface module holds its own copy; a test checks they match).
export const PALETTE = ['', '#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#8b5cf6', '#ec4899', '#ffffff', '#000000']

const even = (n: number) => n - (n % 2)

// The − and + chips change width and height together, STEP pixels each, so a square canvas stays square.
// A side that has reached its limit stays there and the other keeps going, until both are at theirs.
// The width limit is MAX.w or, if narrower, the columns the pane has (nothing wider would fit on screen).
export const STEP = 8

/** One step bigger (dir 1) or smaller (-1) from `from`; `maxW` is the widest the canvas may grow. Never moves a side the wrong way. */
export function stepSize(from: { w: number; ph: number }, dir: 1 | -1, maxW: number = MAX.w): { w: number; ph: number } {
  if (dir === 1) {
    const cap = Math.min(MAX.w, Math.max(MIN.w, maxW))
    return { w: Math.max(from.w, Math.min(cap, from.w + STEP)), ph: Math.max(from.ph, Math.min(MAX.ph, from.ph + STEP)) }
  }
  return { w: Math.min(from.w, Math.max(MIN.w, from.w - STEP)), ph: Math.min(from.ph, Math.max(MIN.ph, from.ph - STEP)) }
}

// Rows the help block under the canvas takes (canvas.ts draws exactly this many while it is open).
export const HELP_ROWS = 9
let helpOpen = true

// The pane's rows: the canvas, its 3 chip rows and status line, the size field, and the help block when open.
const paneRows = (ph: number) => ph / 2 + 7 + (helpOpen ? HELP_ROWS : 0)

export type Lang = 'ko' | 'en'
let lang: Lang = 'ko'

// Everything this module says, per language.
const MSG = {
  ko: {
    usage: `Usage: /paint, /paint bigger|smaller, /paint 100x60 (x, *, × 모두 가능 · 픽셀 단위 · 가로 ${MIN.w}-${MAX.w}, 세로 ${MIN.ph}-${MAX.ph}, 세로는 짝수), /paint export (마지막 내보내기), /paint en|ko (언어)`,
    adjusted: (raw: string, w: number, ph: number) => `${raw.trim()} → ${w}×${ph} 로 맞췄어요 (가로 ${MIN.w}-${MAX.w}, 세로 ${MIN.ph}-${MAX.ph}, 세로는 짝수)`,
    nothingExported: '아직 내보낸 게 없어요: 캔버스에서 "JS 코드 복사"나 "ASCII 복사"를 먼저 누르세요.',
    opened: (w: number, ph: number) => `Paint: ${w}×${ph} 픽셀. 드래그해서 그려요 (키를 쓰려면 캔버스를 먼저 클릭하세요)`,
    biggest: '가장 큰 크기예요',
    biggestFit: (cols: number) => `이 터미널 너비(${cols}칸)에서는 가장 큰 크기예요`,
    smallest: '가장 작은 크기예요',
    sized: (w: number, ph: number) => `${w}×${ph} 픽셀`,
    empty: '아직 그린 게 없어요',
    code: 'JS 코드',
    ascii: 'ASCII 아트',
    copied: (what: string) => `${what}를 클립보드에 복사했어요 (/paint export 로 채팅에도 띄울 수 있어요)`,
    toFile: (file: string) => `클립보드를 못 써서 파일로 저장했어요: ${file}`,
    failed: (err: string) => `복사도 저장도 못 했어요 (${err}). /paint export 로 채팅에서 가져가세요`,
    saved: (file: string, n: number) => `저장했어요: ${file} (${n})`,
    sizeLabel: '크기 ',
    sizePlaceholder: `예: 100x60 또는 100*60 (가로 ${MIN.w}-${MAX.w} × 세로 ${MIN.ph}-${MAX.ph})`,
    apply: '적용',
    switched: '한국어로 바꿨어요',
    needTerminal: 'Paint 캔버스는 터미널에서만 쓸 수 있어요.',
    colors: ['', '빨강', '주황', '노랑', '초록', '파랑', '보라', '분홍', '흰색', '검정'],
    clear: '비어 있음',
  },
  en: {
    usage: `Usage: /paint, /paint bigger|smaller, /paint 100x60 (x, * or × · pixels · width ${MIN.w}-${MAX.w}, height ${MIN.ph}-${MAX.ph}, height even), /paint export (the last export), /paint en|ko (language)`,
    adjusted: (raw: string, w: number, ph: number) => `${raw.trim()} → adjusted to ${w}×${ph} (width ${MIN.w}-${MAX.w}, height ${MIN.ph}-${MAX.ph}, height even)`,
    nothingExported: 'Nothing exported yet: press "Copy JS" or "Copy ASCII" on the canvas first.',
    opened: (w: number, ph: number) => `Paint: ${w}×${ph} px. Drag to draw (click the canvas first for the keys)`,
    biggest: 'This is the biggest size',
    biggestFit: (cols: number) => `This is the biggest that fits this terminal (${cols} columns wide)`,
    smallest: 'This is the smallest size',
    sized: (w: number, ph: number) => `${w}×${ph} px`,
    empty: 'Nothing drawn yet',
    code: 'JS code',
    ascii: 'ASCII art',
    copied: (what: string) => `Copied the ${what} to the clipboard (/paint export shows it in the chat too)`,
    toFile: (file: string) => `No clipboard here, so it was saved to a file: ${file}`,
    failed: (err: string) => `Could neither copy nor save (${err}). Use /paint export to take it from the chat`,
    saved: (file: string, n: number) => `Saved: ${file} (${n})`,
    sizeLabel: 'Size ',
    sizePlaceholder: `e.g. 100x60 or 100*60 (width ${MIN.w}-${MAX.w} × height ${MIN.ph}-${MAX.ph})`,
    apply: 'apply',
    switched: 'Switched to English',
    needTerminal: 'The paint canvas needs the terminal.',
    colors: ['', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'black'],
    clear: 'clear',
  },
} as const

const props = (note?: string) => ({ w: size.w, ph: size.ph, lang, help: helpOpen, ...(note ? { note } : {}) })

/** "en", "english", "영문" … → 'en'; "ko", "korean", "한국어" … → 'ko'; null for anything else. */
export function parseLang(word: string): Lang | null {
  const w = word.trim().toLowerCase()
  if (['en', 'eng', 'english', '영어', '영문'].includes(w)) return 'en'
  if (['ko', 'kr', 'korean', '한국어', '한글'].includes(w)) return 'ko'
  return null
}

// One letter per palette color in exported code (0 is empty, written '.').
export const LETTERS = ['.', 'R', 'O', 'Y', 'G', 'B', 'P', 'M', 'W', 'K']

/** The rows of the part of the drawing that is not empty; null when nothing is drawn. */
export function crop(grid: number[], w: number, ph: number): number[][] | null {
  let x0 = w, x1 = -1, y0 = ph, y1 = -1
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < w; x++)
      if (grid[y * w + x]) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      }
  if (x1 < 0) return null
  const rows: number[][] = []
  for (let y = y0; y <= y1; y++) rows.push(grid.slice(y * w + x0, y * w + x1 + 1))
  return rows
}

/** The drawing as a JS/TS array of strings ('.' clear, a letter per color) with the colors it uses; null when empty. */
export function toCode(grid: number[], w: number, ph: number, language: Lang = 'ko'): string | null {
  const rows = crop(grid, w, ph)
  if (!rows) return null
  const used = [...new Set(rows.flat())].filter(c => c).sort((a, b) => a - b)
  const lines = rows.map(row => `  "${row.map(c => LETTERS[c]).join('')}",`)
  return [
    `// ${rows[0]!.length}x${rows.length} · '.' = ${MSG[language].clear} · ${used.map(c => `${LETTERS[c]} ${MSG[language].colors[c]}`).join(' · ')}`,
    'const SPRITE = [',
    ...lines,
    ']',
    '',
    'const PALETTE = {',
    ...used.map(c => `  ${LETTERS[c]}: '${PALETTE[c]}',`),
    '}',
    '',
  ].join('\n')
}

/** How bright a palette color is, 0..1. */
function brightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** The drawing as block characters, two to a pixel so it keeps its shape; brighter colors are denser. Null when empty. */
export function toAscii(grid: number[], w: number, ph: number): string | null {
  const rows = crop(grid, w, ph)
  if (!rows) return null
  const shade = (c: number) => {
    if (!c) return '  '
    const b = brightness(PALETTE[c]!)
    const ch = b > 0.85 ? '█' : b > 0.6 ? '▓' : b > 0.3 ? '▒' : '░'
    return ch + ch
  }
  return rows.map(row => row.map(shade).join('').replace(/\s+$/, '')).join('\n') + '\n'
}

let lastExport = ''

/**
 * "100x60", "100*60", "100×60" or "100 60" → a size within the limits (width MIN.w-MAX.w, height
 * MIN.ph-MAX.ph pixels, the height made even); `adjusted` says the numbers had to change. Null when it is no size.
 */
export function parseSize(arg: string): { w: number; ph: number; adjusted: boolean } | null {
  const m = arg.trim().toLowerCase().match(/^(\d+)\s*(?:[x×*]|\s)\s*(\d+)$/)
  if (!m) return null
  const w = Math.min(MAX.w, Math.max(MIN.w, Number(m[1])))
  const ph = even(Math.min(MAX.ph, Math.max(MIN.ph, Number(m[2]))))
  return { w, ph, adjusted: w !== Number(m[1]) || ph !== Number(m[2]) }
}

/** The digits the canvas posts, as palette indexes; null when they are not exactly w × ph of 0-9. */
export function decode(text: unknown, w: number, ph: number): number[] | null {
  if (typeof text !== 'string' || text.length !== w * ph || !/^[0-9]+$/.test(text)) return null
  return Array.from(text, Number)
}

/** The picture as an SVG, `size` pixels per canvas pixel; same-color runs in a row are one rect. */
export function toSvg(grid: number[], w: number, ph: number, size = 6): string {
  const rects: string[] = []
  for (let y = 0; y < ph; y++) {
    let x = 0
    while (x < w) {
      const c = grid[y * w + x] ?? 0
      let end = x + 1
      while (end < w && (grid[y * w + end] ?? 0) === c) end++
      if (c) rects.push(`<rect x="${x * size}" y="${y * size}" width="${(end - x) * size}" height="${size}" fill="${PALETTE[c]}"/>`)
      x = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * size}" height="${ph * size}" viewBox="0 0 ${w * size} ${ph * size}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n${rects.join('\n')}\n</svg>\n`
}

let size = { ...SIZE }
let paneColumns = MAX.w // the columns the pane last had to draw in: the canvas may not grow wider than that
let saves = 0

/** Another canvas size: the pane grows to fit and the region is drawn again. */
async function applySize($: any, next: { w: number; ph: number }) {
  size = next
  await $.ui.open({ id: PANE, title: '🎨 Paint', closeOnEscape: true, rows: paneRows(size.ph) }).catch(() => undefined)
  $.ui.invalidate('ui.render') // the region is as big as the render says
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'paint', description: 'Open the paint pane: drag to draw. /paint 100x60 sets the canvas size, /paint en|ko the language' }).catch(() => {})
    return r
  })

  on('command.run', { command: 'paint' }, async ($, e) => {
    let adjusted = ''
    const word = e.args.trim().toLowerCase()
    const asked = parseLang(word.replace(/^lang(uage)?\s*/, ''))
    if (asked) lang = asked
    else if (word === 'export') return { text: lastExport || MSG[lang].nothingExported }
    else if (word === 'bigger' || word === 'smaller') size = stepSize(size, word === 'bigger' ? 1 : -1, paneColumns)
    else if (e.args.trim() !== '') {
      const next = parseSize(e.args)
      if (!next) return { text: MSG[lang].usage }
      size = { w: next.w, ph: next.ph }
      adjusted = next.adjusted ? MSG[lang].adjusted(e.args, next.w, next.ph) : ''
    }
    await $.ui.open({ id: PANE, title: '🎨 Paint', focus: true, closeOnEscape: true, rows: paneRows(size.ph) })
    return { text: adjusted ? `${MSG[lang].opened(size.w, size.ph)}\n${adjusted}` : MSG[lang].opened(size.w, size.ph) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return Text({ children: [MSG[lang].needTerminal] })
    }
    const columns = e.props?.bodyColumns
    if (typeof columns === 'number' && columns > 0) paneColumns = columns
    const { Box, Client, Input } = $.ui.resolve(e)
    return Box({
      flexDirection: 'column',
      children: [
        Client({ key: 'canvas', module: './canvas.ts', props: props(), width: Math.max(size.w, MENU_WIDTH), height: size.ph / 2 + 4 + (helpOpen ? HELP_ROWS : 0) }),
        Input({
          key: 'size',
          label: MSG[lang].sizeLabel,
          placeholder: MSG[lang].sizePlaceholder,
          value: '',
          submitLabel: MSG[lang].apply,
          onSubmit: async value => {
            const next = parseSize(value)
            if (!next) return void $.ui.toast(MSG[lang].usage)
            await applySize($, { w: next.w, ph: next.ph })
            $.ui.toast(`Paint: ${next.adjusted ? MSG[lang].adjusted(value, next.w, next.ph) : MSG[lang].sized(next.w, next.ph)}`)
          },
        }),
      ],
    })
  })

  on('ui.message', async ($, e) => {
    const data = e.data as { save?: unknown; export?: unknown; grid?: unknown; resize?: unknown; lang?: unknown; help?: unknown; w?: unknown; ph?: unknown } | null
    if (e.element !== 'canvas' || !data || typeof data !== 'object') return {}
    // posted by code on the surface: check it is the canvas we drew before acting on it
    if (data.w !== size.w || data.ph !== size.ph) return {}
    const t = MSG[lang]

    if (typeof data.help === 'boolean') {
      helpOpen = data.help
      await applySize($, size) // the pane and the region change height
      return { props: props() }
    }

    if (data.lang === 'ko' || data.lang === 'en') {
      lang = data.lang
      $.ui.invalidate('ui.render') // the size field's words change too
      return { props: props(MSG[lang].switched) }
    }

    if (data.resize === 1 || data.resize === -1) {
      const next = stepSize(size, data.resize, paneColumns)
      if (next.w === size.w && next.ph === size.ph) {
        // nothing moved: the limit (or, if the terminal is narrower than MAX.w, the terminal's width and the height limit)
        const byTerminal = data.resize === 1 && paneColumns < MAX.w && size.w >= paneColumns
        return { props: props(data.resize === 1 ? (byTerminal ? t.biggestFit(paneColumns) : t.biggest) : t.smallest) }
      }
      await applySize($, next)
      return { props: props(t.sized(size.w, size.ph)) }
    }

    if (data.export === 'js' || data.export === 'ascii') {
      const grid = decode(data.grid, size.w, size.ph)
      if (!grid) return {}
      const text = data.export === 'js' ? toCode(grid, size.w, size.ph, lang) : toAscii(grid, size.w, size.ph)
      if (!text) return { props: props(t.empty) }
      lastExport = text
      const what = data.export === 'js' ? t.code : t.ascii
      const copied = await $.ui.copy({ text, surface: e.surface }).catch(() => ({ isCopied: false }))
      if (copied.isCopied) {
        $.ui.toast(`Paint: ${what}`)
        return { props: props(t.copied(what)) }
      }
      // no clipboard on this surface: a file instead
      const home = (await $.env.get('HOME')) ?? '.'
      const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = `${home}/Pictures/paint-${stamp}.${data.export === 'js' ? 'js' : 'txt'}`
      try {
        await $.fs.write(file, text)
        return { props: props(t.toFile(file)) }
      } catch (err) {
        return { props: props(t.failed(String(err))) }
      }
    }

    if (data.save === undefined) return {}
    const grid = decode(data.save, size.w, size.ph)
    if (!grid) return {}
    const home = (await $.env.get('HOME')) ?? '.'
    const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = `${home}/Pictures/paint-${stamp}.svg`
    try {
      await $.fs.write(file, toSvg(grid, size.w, size.ph))
      $.ui.toast(`Paint: saved ${file}`)
      saves += 1
      return { props: props(t.saved(file, saves)) }
    } catch (err) {
      $.ui.toast(`Paint: save failed (${String(err)})`)
      return {}
    }
  })
}
