# paint

A paint canvas that lives in a [Claude Code](https://claude.com/claude-code) pane. Open it with `/paint` and draw with the mouse.

- Drag to draw (left button), drag with the right button to erase
- Palette of 9 colors plus an eraser, brush sizes 1-4, flood fill, straight lines
- Undo / redo (20 steps), resizable canvas, English and Korean
- Save as SVG, or copy the drawing as a JS/TS array or as ASCII art
- A help block with all the shortcuts sits under the canvas (fold it with `?`)

> **Status: early (0.9).** It was built against Claude Code's mod API and tested with a simulated engine and the API's type definitions. How mouse drags, `Shift` and `Ctrl+Z` reach it depends on your terminal (see [Terminals](#terminals)). Issues and reports of what works where are welcome.

## Install

```
/plugin install paint --marketplace kwonsean/claude-code-paint
```

(Claude Code 2.1.275 or later. Or from a shell: `claude plugin marketplace add kwonsean/claude-code-paint`, then `claude plugin install paint@claude-code-paint`.) Restart Claude Code, then run `/paint`.

## Use

`/paint` opens the pane. Click the canvas once so the keys reach it.

| | |
|---|---|
| Draw / erase | drag with the left / right mouse button |
| Colors | `1`-`9`, `0` is the eraser (or click the swatches) |
| Tools | `p` pen, `l` line, `f` fill, `b` brush size (1-4) |
| Straight line | the `Line` tool (`l`), or hold `Shift` while dragging (snaps to 0 / 45 / 90°) |
| Undo / redo | `z` or `Ctrl+Z` / `y`, `Ctrl+Y` or `Shift+Z` |
| Clear | `c` (undoable) |
| Save | `e` writes `~/Pictures/paint-<time>.svg` |
| Copy as code | `j` copies the drawing, cropped, as `const SPRITE = ["..R..", ...]` plus a `PALETTE` |
| Copy as ASCII | `a` copies it as `█▓▒░` blocks, two characters per pixel, brighter colors denser |
| Help | `?` or `h` folds / opens the help block |
| Language | the chip at the end of the third row, or `/paint en` / `/paint ko` (Korean is the default) |

The last JS/ASCII export can be printed in the chat with `/paint export`. If the terminal has no clipboard path, exports are written to `~/Pictures` instead.

### Canvas size

Change it with the `−` `+` chips (or `[` `]`), `/paint bigger|smaller`, `/paint 100x60`, or by typing it in the field under the canvas. Separate the numbers with `x`, `*`, `×` or a space: `100x60`, `100*60`, `100 60`.

| | width | height |
|---|---|---|
| minimum | 24 px | 12 px |
| maximum | 160 px | 100 px |

The height is made even (two pixels share one character row, so 25 becomes 24). A value outside the limits is moved to the nearest limit and you are told what it became. The chips step through 64 · 80 · 112 · 144 · 160 px wide. The menu rows keep their full width even on a narrow canvas. Resizing keeps what fits of the drawing (from the top left) and clears undo/redo.

## How it works

The canvas is drawn in pixels, two to a character with a half block (`▀`: the top pixel is the character color, the bottom pixel the background). Mouse and keys are handled on the surface by a `Client` module (`hooks/canvas.ts`), so dragging stays smooth; the hooks module (`hooks/register.ts`) opens the pane and does what needs the host: saving files, the clipboard, resizing the pane, the size field and the language.

## What it touches

From the mod API's own report of what the code calls: it reads the `HOME` environment variable, writes files **only** when you save or when an export cannot use the clipboard (into `~/Pictures`), and uses the clipboard when you ask it to copy. It makes **no network requests** and runs **no other programs**.

## Terminals

- Mouse drags need a terminal that passes mouse events to the program. Sub-cell precision (smoother vertical position) comes from terminals that report pixels: kitty, Ghostty, iTerm2, WezTerm. Elsewhere the top pixel of a character cell is used.
- Many terminals keep `Shift`+drag for selecting text and never pass it on. Use the `Line` tool there.
- Claude Code or your terminal may use `Ctrl+Z` for something else. `z` and `y` always work.

## Development

- `hooks/register.ts` is the hooks module, `hooks/canvas.ts` the surface module (it is self-contained, so its palette and limits are copies of the ones in `register.ts`; keep them in step).
- `tests/` uses the engine's testing helpers (`claude-code/testing`).
- Check a change with `claude plugin validate .`. After editing an installed copy, bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update paint@claude-code-paint`, because installed plugins run from a cached copy.

## License

[MIT](LICENSE)

---

## 한국어

패널을 그림판처럼 씁니다. `/paint` 로 열고 마우스를 끌어서 그립니다.

- 왼쪽 버튼으로 그리고, 오른쪽 버튼으로 지웁니다. 위쪽 줄에서 색(0은 지우개)과 도구를 클릭하거나, 캔버스를 한 번 클릭한 뒤 키로 고릅니다.
- 키: `1`-`9` 색, `0` 지우개, `p` 펜, `l` 직선, `f` 채우기, `b` 굵기(1-4), `z` 되돌리기(`Ctrl+Z`도 돼요), `y` 다시 실행(`Ctrl+Y`, `Shift+Z`), `c` 지우기, `e` 저장
- 직선: `직선` 도구(`l`)는 누른 곳에서 끌고 있는 곳까지 곧은 선을 그려요. 펜이나 직선 도구에서 `Shift` 를 누른 채 끌면 가로·세로·45° 중 가까운 쪽으로 맞춰져요. (터미널에 따라 Shift+드래그는 텍스트 선택에 쓰여서 프로그램에 안 넘어올 수 있어요. 그럴 땐 `직선` 도구를 쓰세요.)
- 캔버스 아래에 도움말(단축키 목록)이 있어요. `?`(또는 `h`) 키나 첫 줄 끝의 `?` 칩으로 접고 펼쳐요.
- 저장하면 `~/Pictures/paint-날짜.svg` 가 만들어집니다.
- 크기: `−` `+` 칩, `[` `]` 키, `/paint 100x60`, 또는 캔버스 아래 입력칸에 직접 입력해요. 구분은 `x`, `*`, `×`, 공백 모두 돼요 (`100x60`, `100*60`, `100 60`).

  | | 가로 | 세로 |
  |---|---|---|
  | 최소 | 24 픽셀 | 12 픽셀 |
  | 최대 | 160 픽셀 | 100 픽셀 |

  세로는 짝수로 맞춰져요 (픽셀 둘이 글자 한 줄을 나눠 써서요: 25 → 24). 범위를 벗어나면 가장 가까운 한계로 맞추고 무엇으로 바꿨는지 알려 줘요. `−` `+` 칩은 64 · 80 · 112 · 144 · 160 (가로) 단계로 움직여요. 캔버스가 좁아도 메뉴는 잘리지 않아요.
- 언어: 세 번째 줄 끝의 칩이나 `/paint en` `/paint ko` 로 영어와 한국어를 바꿔요.
- 한 글자에 세로 픽셀 둘을 넣는 반블록으로 그려서, 터미널이 마우스 위치를 픽셀 단위로 알려 주면(kitty, Ghostty, iTerm2, WezTerm) 더 정확하게 그려집니다.

내보내기: `JS 코드 복사`(`j`) 는 그린 부분만 잘라 `const SPRITE = ["..R..", ...]` 배열과 `PALETTE` 로, `ASCII 복사`(`a`) 는 밝기에 따라 `█▓▒░` 블록 글자로 클립보드에 넣어요. `/paint export` 는 마지막으로 내보낸 내용을 채팅에 띄웁니다. 클립보드를 못 쓰면 `~/Pictures` 에 파일로 저장해요.
