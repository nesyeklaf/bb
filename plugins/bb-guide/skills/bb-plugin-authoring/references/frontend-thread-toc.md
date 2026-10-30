# Thread table-of-contents rail

`app.slots.experimental_threadTocExtension({ id, title, useBands, tab?, onBandClick? })`
extends the thin tick rail beside an open thread (one tick per user message).
`useBands({ threadId, projectId })` is a hook returning
`{ fromSeq, toSeq, hue, label?, dashed?, active? }[]` (message seqs, hue 0-360).
Each band draws a thin vertical bracket right of the ticks over every tick
whose seq lies in the range; a range without a tick takes the next tick.
`dashed` draws a dashed line, `active` a thicker glowing one, and a click calls
`onBandClick(band, { threadId, projectId })`. Overlapping bands use up to
three lanes. `tab: { label, component }` adds a tab to the rail popover next
to Your messages and Agent messages; the component gets `threadId`,
`projectId`, `jumpToSeq(seq)`, `railSelection` and `clearRailSelection()`.
Dragging along the rail marks a range: `railSelection` is
`{ fromSeq, toSeq }` (first marked message to just before the next user
message) or null. The rail and popover stay open while it is set; Escape,
`clearRailSelection` or a thread switch clears it. A plain click behaves as
without the slot. Both the bands hook and the tab mount in crash boundaries.
