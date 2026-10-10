import assert from "node:assert/strict";
import test from "node:test";
import {
  createComposerToolbarFitCache,
  getComposerToolbarFitProjection,
  getComposerToolbarLayoutStyleKey,
} from "../src/prompt-editor/composerToolbarFit.js";

const widths = [700, 660, 620, 580, 540, 500, 460, 420];

test("toolbar keeps the existing collapse order and restores labels when space returns", () => {
  const cache = createComposerToolbarFitCache();
  const measured = () => widths;
  for (let step = 0; step < widths.length; step++) {
    assert.equal(cache.select(widths[step]!, "wide", measured), step);
  }
  assert.equal(cache.select(300, "wide", measured), 7);
  assert.equal(cache.select(800, "wide", measured), 0);
  assert.deepEqual(getComposerToolbarFitProjection(5), {
    compactPriorities: ["0", "1", "2", "3"],
    providerCompact: true,
    thoughtIcon: false,
    modelIcon: false,
  });
  assert.equal(getComposerToolbarFitProjection(6).thoughtIcon, true);
  assert.equal(getComposerToolbarFitProjection(7).modelIcon, true);
});

test("rapid width reversals reuse measurements instead of rebuilding DOM probes", () => {
  const cache = createComposerToolbarFitCache();
  let measurements = 0;
  const measure = () => {
    measurements++;
    return widths;
  };
  for (let run = 0; run < 8; run++) {
    for (const width of [800, 680, 600, 530, 470, 400, 470, 600, 800]) {
      cache.select(width, "wide", measure);
    }
  }
  assert.equal(measurements, 1);
});

test("container breakpoint changes have independent cached widths", () => {
  const cache = createComposerToolbarFitCache();
  let measurements = 0;
  const measure = (required: number[]) => () => {
    measurements++;
    return required;
  };
  assert.equal(cache.select(650, "wide", measure(widths)), 2);
  assert.equal(cache.select(350, "mobile", measure(widths.map((width) => width - 350))), 0);
  assert.equal(cache.select(650, "wide", measure(widths)), 2);
  assert.equal(measurements, 2);
});

test("language, asynchronous controls and font changes invalidate every breakpoint cache", () => {
  const cache = createComposerToolbarFitCache();
  cache.select(650, "wide", () => widths);
  cache.select(350, "mobile", () => widths.map((width) => width - 350));
  cache.invalidate();
  assert.equal(
    cache.select(650, "wide", () => widths.map((width) => width + 80)),
    4,
  );
  assert.equal(
    cache.select(350, "mobile", () => widths.map((width) => width - 270)),
    2,
  );
});

test("hidden toolbars do not measure and nonmonotonic steps still honor the first fitting tier", () => {
  const cache = createComposerToolbarFitCache();
  assert.equal(
    cache.select(0, "wide", () => assert.fail("hidden measurement")),
    null,
  );
  assert.equal(
    cache.select(600, "wide", () => [700, 590, 620, 580, 540, 500, 460, 420]),
    1,
  );
});

test("rolling label transforms keep cached widths while font and spacing changes invalidate them", () => {
  const style = (values: Record<string, string>) =>
    ({
      length: Object.keys(values).length,
      item: (index: number) => Object.keys(values)[index],
      getPropertyValue: (name: string) => values[name],
    }) as unknown as CSSStyleDeclaration;
  assert.equal(
    getComposerToolbarLayoutStyleKey(style({ transform: "translateY(10px)", opacity: "0.2" })),
    getComposerToolbarLayoutStyleKey(style({ transform: "translateY(0px)", opacity: "1" })),
  );
  assert.notEqual(
    getComposerToolbarLayoutStyleKey(style({ "font-size": "14px", padding: "4px" })),
    getComposerToolbarLayoutStyleKey(style({ "font-size": "18px", padding: "4px" })),
  );
});
