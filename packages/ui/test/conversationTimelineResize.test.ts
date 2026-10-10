import assert from "node:assert/strict";
import test from "node:test";
import { TimelineContentWidthTracker } from "../src/v4/conversationTimelineResize.js";
import {
  resolveConversationTurnNavigatorWidthBucket,
  shouldHydrateConversationTurnNavigatorDirectory,
} from "../src/v4/conversationTurnNavigatorHelpers.js";
import {
  anchorActionAfterContentChange,
  shouldAdjustVirtualizerForItemSizeChange,
} from "../src/v4/timelineScrollAnchor.js";

function shouldCompensateReadingPosition(tracker: TimelineContentWidthTracker): boolean {
  return shouldAdjustVirtualizerForItemSizeChange({
    following: false,
    suppressAdjustment: false,
    contentWidthChanging: tracker.isChanging(),
    itemEnd: 300,
    scrollTop: 500,
  });
}

test("row resize arrives before the content observer and suppresses the first size correction", () => {
  const tracker = new TimelineContentWidthTracker();
  tracker.reset(900);
  assert.equal(shouldCompensateReadingPosition(tracker), true);

  tracker.observe(720);
  assert.equal(shouldCompensateReadingPosition(tracker), false);
  assert.equal(anchorActionAfterContentChange(true, tracker.isChanging()), "hold");

  tracker.observe(720);
  assert.equal(tracker.isChanging(), true);
  tracker.settle();
  assert.equal(shouldCompensateReadingPosition(tracker), true);
  assert.equal(anchorActionAfterContentChange(true, tracker.isChanging()), "stickToBottom");
  assert.equal(anchorActionAfterContentChange(false, tracker.isChanging()), "hold");
});

test("content resize arrives first and repeated row notifications preserve the pending width", () => {
  const tracker = new TimelineContentWidthTracker();
  tracker.reset(900);
  tracker.observe(720);
  for (let row = 0; row < 8; row += 1) {
    tracker.observe(720);
    assert.equal(shouldCompensateReadingPosition(tracker), false);
  }
  tracker.settle();
  assert.equal(tracker.isChanging(), false);
});

test("rapid reverse resizes settle at the latest observed width without a geometry read", () => {
  const tracker = new TimelineContentWidthTracker();
  tracker.reset(900);
  for (const width of [880, 740, 800, 900, 850, 760]) {
    tracker.observe(width);
  }
  assert.equal(tracker.isChanging(), true);
  tracker.settle();
  tracker.observe(760);
  assert.equal(tracker.isChanging(), false);
  tracker.observe(800);
  assert.equal(tracker.isChanging(), true);
});

test("initial rows, empty history and remount establish their own width baseline", () => {
  const tracker = new TimelineContentWidthTracker();
  assert.equal(tracker.isChanging(), false);
  tracker.observe(720);
  assert.equal(tracker.isChanging(), false);
  tracker.observe(600);
  assert.equal(tracker.isChanging(), true);
  tracker.reset(600);
  assert.equal(tracker.isChanging(), false);
  tracker.observe(0);
  assert.equal(tracker.isChanging(), true);
  tracker.settle();
  assert.equal(tracker.isChanging(), false);
});

test("width comparison matches clientWidth rounding and ignores invalid observations", () => {
  const tracker = new TimelineContentWidthTracker();
  tracker.reset(720.2);
  tracker.observe(720.4);
  assert.equal(tracker.isChanging(), false);
  for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    tracker.observe(width);
    assert.equal(tracker.isChanging(), false);
  }
  tracker.observe(720.6);
  assert.equal(tracker.isChanging(), true);
});

test("directory qualification changes only at the existing rounded 864px boundary", () => {
  const hydration = (containerWidthPx: number) =>
    shouldHydrateConversationTurnNavigatorDirectory({
      containerWidthPx,
      canLoadOlder: true,
      hasLoadHandler: true,
      loadingOlder: false,
    });
  for (let width = 640; width < 1200; width += 0.25) {
    const bucket = resolveConversationTurnNavigatorWidthBucket(width);
    assert.equal(bucket, Math.round(width) >= 864 ? 864 : 0);
    assert.equal(hydration(bucket), hydration(Math.max(0, Math.round(width))));
  }
  assert.equal(resolveConversationTurnNavigatorWidthBucket(863.49), 0);
  assert.equal(resolveConversationTurnNavigatorWidthBucket(863.5), 864);
  assert.equal(resolveConversationTurnNavigatorWidthBucket(-1), 0);
});
