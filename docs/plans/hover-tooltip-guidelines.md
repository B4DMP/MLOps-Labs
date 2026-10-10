# Hover tooltips: dos and don'ts

Native `title=` is banned outside `Admin.tsx`. `game-ui/src/noNativeTitle.test.ts` fails on any
`title` attribute on a DOM tag, `motion.*`, `IconButton` or `Avatar`.

## Which tooltip to use

- **Do** use `HoverTooltip` (`components/HoverToolTip.tsx`) for ordinary hints.
- **Do** use the dossier's shared info tag (`showInfoTag` in `StakeholderDossier.tsx`) for the tab
  strip and the Power / Interest / Patience / Intel badges. It takes a string or a React node.
- **Don't** add a second tooltip mechanism, and don't nest one tooltip inside another.
- **Don't** wrap an element that already shows the same text visibly. Drop the tooltip.

## Wrapping elements

- **Do** pass `labelsChild` for icon-only controls. A native `title` used to supply their
  accessible name; without this they have none.
- **Do** pass `block` for full-width block children, and check flex/grid items. The wrapper is an
  inline `span`, so selectors like `.row > .btn` stop matching and `display` can change.
- **Do** pass `portalTarget` when the element sits inside a modal or a transformed panel. The
  default `document.body` can render behind the modal (tooltip z-index is 10010).
- **Do** pass a conditional value freely (`description={cond ? "x" : undefined}`). An empty
  description renders the children untouched.
- **Don't** wrap `position: absolute/fixed` elements or anything inside an `<svg>`. The wrapper
  collapses to zero size. Wrap an inner element instead.
- **Don't** wrap `th`/`td` cells. Wrap their content.
- **Don't** wrap an element with no hover area (zero-count cells, `pointer-events: none` nodes).
- Disabled buttons work as-is: the wrapper receives the hover.

## Where a wrapper cannot go: `useTooltipController`

Same box, placement and dismissal as `HoverTooltip`, for what the wrapper would break: elements
inside an `<svg>`, and anchors built in `.map()` loops. Call `useTooltipController()` once, spread
`tip.bind(content)` on each anchor (it returns `onMouseEnter`, `onMouseLeave`, `onFocus`, `onBlur`;
empty content shows nothing) and render `tip.bubble` once. Also fine for flex children whose
siblings are matched by `:first-child` / `:last-child`. Do not use it where a plain `HoverTooltip`
works. The composer is the user.

## Rich content (bold, line breaks)

`description` accepts any React node. Pass `ariaText` (plain text) with it when you use
`labelsChild`; a string description is used as the label automatically.

- **Do** build structured bodies as small components with their own CSS module
  (`TabTagDetail`, `HoverTagDetails`). Pass plain text separately for `aria-label`.
- **Do** keep each logical piece unbreakable (`white-space: nowrap` on a chunk) so lines wrap only
  between items, never inside "2 of 2 notes found" or "High interest".
- **Do** put a question and its answer on separate lines.
- **Don't** use `\n` strings for layout and hope the wrapping works.
- **Don't** rely on `font-weight: 700` for emphasis in the Delius tag font. It has one weight, and
  the tag body is already semi-bold, so bold looks identical. Set the body to regular (400) and
  bold only the highlights.
- **Don't** rely on CSS custom properties (`--fs-*`, `--hairline`) in tag content. The tag is
  portaled out of the dossier's scope, so always give `var()` a fallback or use a literal.

## Theme

- **Do** wrap a themed area in `HoverTooltipTheme variant="parchment"`. Every `HoverTooltip` below
  it picks up the dossier look automatically. The dossier window is wrapped once.
- **Do** use `variant="paper"` for the pitch composer, wrapped once at its container.
- **Don't** restyle individual tooltips per call site.

## Working in shared files

- **Do** put new tooltip styles in their own CSS module. Other sessions rewrite
  `StakeholderDossier.module.css`, and an appended block was silently lost once.
- **Do** re-read a file right before editing it, and keep edits there small (import a component
  rather than inlining markup).
- **Do** run only `StakeholderDossier.test.tsx`, `HoverToolTip.test.tsx` and
  `noNativeTitle.test.ts` for tooltip changes.
