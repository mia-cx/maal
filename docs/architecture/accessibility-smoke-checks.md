# Accessibility smoke checks for split product components

Use this checklist when refactoring dialogs, sheets, popovers, tabs, and forms.

## Dialogs and sheets

- Trigger opens with keyboard and pointer.
- Focus moves into the dialog/sheet.
- Escape or close action returns focus to a sensible trigger.
- Title is present and visible or intentionally screen-reader-only.
- Destructive actions use explicit labels and confirmation copy.

## Popovers and comboboxes

- Input has an accessible label or `aria-label`.
- Options are keyboard reachable.
- Active option styling is paired with focus/selection state.
- Loading and error states are visible text, not color-only.

## Tabs/category navigation

- Active category is programmatically selected.
- Category changes do not discard draft state unless intended.
- Disabled categories have a visible reason when user action is expected.

## Forms

- Fields have labels.
- Validation errors are rendered near the field or form action.
- Busy state disables duplicate submission.
- Success/failure state is represented in text.
