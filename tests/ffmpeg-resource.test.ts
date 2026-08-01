import assert from "node:assert/strict";
import test from "node:test";
import { boundedFfmpegArgs } from "../lib/media/ffmpeg";

test("FFmpeg worker uses one codec and filter-complex thread", () => {
  assert.deepEqual(boundedFfmpegArgs(["-i", "input.mp4"]), [
    "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", "-i", "input.mp4",
  ]);
});
