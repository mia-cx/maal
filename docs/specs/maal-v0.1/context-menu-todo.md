# Custom context menu TODO

Maal needs a custom right-click / long-press context menu for schedule and menu surfaces. This is not part of the current slice, but keep the interaction model in mind as meal cards gain more direct actions.

## Candidate surfaces

- Scheduled meal cards
- Floating meal pool cards
- Month/day cells
- My Menu recipe rows/cards
- Future household switcher / household settings

## Candidate actions

- Preview meal
- Move to date
- Unschedule / move to pool
- Duplicate meal
- Replace meal
- Mark cooked / skipped
- Add note
- Open recipe in My Menu
- Edit appliance requirements once household settings exist

## Interaction requirements

- Right-click on desktop.
- Long-press or overflow button on touch devices.
- Keyboard equivalent via focused item shortcut/menu key.
- Must not interfere with drag/drop long-press behavior.
- Use theme tokens and compact radius.
- No browser-native image drag/context behavior should leak through meal thumbnails.
- Context menu should operate on the meal object in the schedule store, not directly on recipes or DB rows.

## Open questions

- Should context menu be global primitive or schedule-specific first?
- Which actions belong on calendar cells vs meal cards?
- Destructive actions must always use a confirmation dialog before deleting.
- Should non-delete destructive actions require confirmation or undo toast?
- How should context menu actions map to future D1-backed server actions?
