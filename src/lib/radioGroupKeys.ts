// =================================================================
// Arrow-key navigation for button-based role="radiogroup" grids.
// =================================================================
// WAI-ARIA radio pattern: arrows move focus and select (selection follows
// focus), wrapping at the ends; Home/End jump to the first/last radio.
// Pair with a roving tabIndex so the group is one Tab stop.
// =================================================================

type RadioGroupKeyEvent = {
  key: string;
  currentTarget: HTMLElement;
  preventDefault(): void;
};

/** onKeyDown for the radiogroup container. Clicks the newly focused radio. */
export function onRadioGroupKeyDown(e: RadioGroupKeyEvent): void {
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const n = radios.length;
  if (!n) return;
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  let next: number;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = n - 1;
  else return;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}

/** Roving tabIndex: the checked radio is the Tab stop, or the first one when none is checked. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
