// docs/AI_HOOK_PROMPTS_V6.md — Ide 26-30. Epik disalurkan ke lingkungan
// (meteor, badai debu, arsitektur, petir, kereta), bukan ke anatomi manusia
// — manusia (kalau ada) cuma duduk/berdiri diam.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { config } from "../lib/config";

const OUT_DIR = path.join(process.cwd(), "test_output/viral-hook-test");
const REAL_VIDEO = "/Users/hadrava/Desktop/2026-08-09 17.29.07.mp4";
const PRODUCT_PHOTO = path.join(process.cwd(), "storage/lab-samsungssd/0.jpg");

const MIME: Record<string, string> = { ".jpg": "image/jpeg" };
function imageToDataUri(p: string): string {
  const buf = fs.readFileSync(p);
  return `data:${MIME[path.extname(p).toLowerCase()] ?? "image/jpeg"};base64,${buf.toString("base64")}`;
}

interface Idea {
  key: string;
  duration: number;
  mode: "i2v" | "r2v";
  prompt: string;
  negative: string;
  xfadeOffset: number;
}

const IDEAS: Idea[] = [
  {
    key: "idea26-meteor",
    duration: 8,
    mode: "r2v",
    xfadeOffset: 7.8,
    prompt:
      "Cinematic vertical shot, anamorphic feel, shallow depth of field. A quiet Indonesian residential " +
      "street at dusk seen from ground level: low houses, a warung, overhead cables, deep orange sky. " +
      "Everything is calm and still. No people anywhere. Beat 1 (0-1.5s): the sky is calm. Then a brilliant " +
      "streak of white-hot light tears across the clouds from the top of frame, leaving a glowing trail and " +
      "a widening sonic shock ring in the air. Beat 2 (1.5-3s): it slams into the middle of the street. A " +
      "blinding flash. A dome of dust and debris explodes outward in every direction, rolling down the " +
      "street toward the camera, cables whipping, roof tiles lifting. The camera shakes violently. Beat 3 " +
      "(3-5s): the dust wall reaches the camera and washes over it, everything goes near-white for a moment, " +
      "then the dust begins to thin and settle in the still air. Beat 4 (5-6.5s): through the settling dust, " +
      "a crater is revealed in the middle of the asphalt, cracked outward in a spiderweb, glowing hot orange " +
      "along the fissures, smoke curling upward. Beat 5 (6.5-8s): the camera pushes forward slowly and " +
      "steadily into the crater. At the exact centre, resting on the glowing cracked ground, sits THE " +
      "PRODUCT from the reference image — completely intact, cool, undamaged, matching the reference image " +
      "exactly in colour, shape and proportion. Do not redesign it. FINAL FRAME: the product fills the " +
      "centre of frame in sharp focus, resting in the glowing crater, smoke drifting slowly around it.",
    negative: "no people, no bodies, no faces, no injured, no burning product, no melted product, no text, no logo, no cartoon effects",
  },
  {
    key: "idea27-tembok-debu",
    duration: 9,
    mode: "r2v",
    xfadeOffset: 8.8,
    prompt:
      "Cinematic vertical wide shot, telephoto compression. An Indonesian kampung seen across low rooftops " +
      "in the afternoon, hills far in the distance, warm hazy light. One person stands alone on a flat " +
      "rooftop in the middle distance, back to camera, small in frame, holding something at their side. " +
      "Beat 1 (0-2s): calm and hot. Laundry moves gently on a line. The distant horizon begins to darken. " +
      "Beat 2 (2-4s): a colossal wall of brown dust, many times taller than the tallest building, rolls " +
      "silently over the far hills and advances toward the kampung, churning and boiling upward, swallowing " +
      "the horizon completely. Beat 3 (4-6s): the dust wall reaches the kampung and consumes it row by row " +
      "— rooftops, antennas, laundry lines vanish into the brown darkness. The light drops to almost " +
      "nothing. The camera holds still. Beat 4 (6-7.5s): everything is dark brown and blind. Then, in the " +
      "very centre of frame, a perfect circle of clear calm air remains — untouched by the dust, still lit " +
      "by warm golden sunlight, like a hole punched through the storm. Beat 5 (7.5-9s): inside that circle " +
      "of calm stands the person, unbothered, hair and clothes completely still, holding THE PRODUCT from " +
      "the reference image, matching it exactly in colour, shape and proportion. The camera pushes in " +
      "toward them. FINAL FRAME: the person stands calm in the circle of golden light holding the product, " +
      "centered, the raging dark dust wall filling the rest of the frame around them.",
    negative: "no crowds, no running people, no panic, no faces close up, no distorted body, no destroyed houses, no text, no logo",
  },
  {
    key: "idea28-kota-terlipat",
    duration: 9,
    mode: "i2v",
    xfadeOffset: 8.8,
    prompt:
      "Cinematic vertical shot, wide lens, from a low table-height position. A Jakarta street at golden " +
      "hour: shophouses, warung awnings, parked motorbikes, tangled cables. In the immediate foreground sits " +
      "a small wooden table with THE PRODUCT on it, exactly as in the reference image, sharp and close to " +
      "camera. Beat 1 (0-1.5s): calm and ordinary. Warm light, everything still. Beat 2 (1.5-3s): a deep " +
      "rumble. Hairline cracks race across the asphalt down the whole length of the street. Beat 3 (3-6s): " +
      "the entire far end of the street begins to lift and CURVE upward, buildings and road and cables " +
      "bending together like a carpet being rolled, rising until the distant part of the city hangs " +
      "vertically overhead, upside down against the sky. Motorbikes and awnings stay attached to the " +
      "folding street as if glued. No debris falls. The movement is smooth, enormous and silent. Beat 4 " +
      "(6-8s): the folded city settles into an impossible vertical wall of streets arching over the frame, " +
      "golden light now falling from between the buildings above. Beat 5 (8-9s): the small wooden table in " +
      "the foreground has not moved at all. THE PRODUCT still sits on it perfectly level and still, sharp, " +
      "undamaged, identical to the reference image, with the folded city towering behind it. FINAL FRAME: " +
      "the product sits still on the table in sharp focus in the foreground, the impossible vertical city " +
      "filling the background behind it.",
    negative: "no people, no bodies, no faces, no falling debris, no collapsing buildings, no destruction, no fire, no text, no logo",
  },
  {
    key: "idea29-petir",
    duration: 8,
    mode: "i2v",
    xfadeOffset: 7.8,
    prompt:
      "Cinematic vertical shot, locked-off tripod, night. An ordinary Indonesian home living room during a " +
      "storm, lit only by a dim lamp. THE PRODUCT sits on a low wooden table in the centre of frame exactly " +
      "as in the reference image. Rain streaks the window behind. Beat 1 (0-1.5s): dim, quiet, ordinary. " +
      "Rain on the glass. The product sits still. Beat 2 (1.5-3s): a lightning flash floods the room white. " +
      "In that instant the room is completely different — the walls are now bare concrete, unfinished and " +
      "raw. Darkness returns. The product has not moved. Beat 3 (3-4.5s): a second flash. Now the room is a " +
      "lush overgrown jungle, vines across the ceiling, ferns on the floor, rain dripping through leaves. " +
      "Darkness returns. The product has not moved. Beat 4 (4.5-6s): a third flash. Now the room is deep " +
      "underwater, light rippling across the surfaces, small fish drifting, furniture floating slightly. " +
      "Darkness returns. The product has not moved. Beat 5 (6-8s): a final, longer flash. The room is back " +
      "to exactly the ordinary living room from Beat 1, dim lamp and rain on the window, completely " +
      "unchanged. The product sits in the same spot, dry, undamaged and sharp. FINAL FRAME: the product " +
      "sits still on the wooden table in the dim ordinary living room, centered and sharp, identical to the " +
      "reference image, rain on the window behind.",
    negative: "no people, no bodies, no faces, no strobing, no rapid flicker, no wet product, no damaged product, no text, no logo",
  },
  {
    key: "idea30-krl",
    duration: 9,
    mode: "r2v",
    xfadeOffset: 8.8,
    prompt:
      "Cinematic vertical shot, locked-off tripod at seated eye level. An ordinary Indonesian living room in " +
      "the afternoon: tiled floor, a sofa, a wall clock, a plain painted wall across the back of frame. One " +
      "young Indonesian person sits calmly on the sofa facing the camera, holding THE PRODUCT from the " +
      "reference image in both hands, matching it exactly in colour, shape and proportion. Beat 1 (0-1.5s): " +
      "calm and ordinary. They are relaxed, looking at the camera. Beat 2 (1.5-2.5s): a deep vibration " +
      "builds. The wall clock rattles. Dust shakes loose from the ceiling. A distant train horn sounds, " +
      "getting closer fast. Beat 3 (2.5-6s): a full-size commuter train bursts through the back wall from " +
      "the left and roars horizontally across the entire room behind the sofa, filling the whole back of " +
      "frame, windows and lights streaking past, wind blasting through the room, curtains and papers " +
      "flying, the person's hair and shirt whipping violently. Beat 4 (6-8s): the train's last carriage " +
      "passes and exits through the right side of frame. The wind dies. Dust and papers drift down. The " +
      "back wall is now an open train-sized gap with rails running through it. Beat 5 (8-9s): the person " +
      "has not moved at all. Still seated, still calm, still holding the product in exactly the same " +
      "position, hair settling back down, they say calmly in Indonesian: \"ini bukan efek, sumpah\", " +
      "natural conversational tone, not a newsreader. Do not speak English. FINAL FRAME: the person sits " +
      "calmly holding the product at chest height, centered and sharp, the open wall and rails visible " +
      "behind them, dust settling.",
    negative: "no crowds, no other people, no injury, no blood, no fire, no derailment, no destroyed sofa, no distorted face, no extra fingers, no text, no logo, no English speech",
  },
];

async function apiRequest(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function submitOne(idea: Idea): Promise<string> {
  const content: unknown[] = [{ type: "text", text: `${idea.prompt}. Negative: ${idea.negative}` }];
  if (idea.mode === "i2v") {
    content.push({ type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) } });
  } else {
    content.push({ type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) }, role: "reference_image" });
  }
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content,
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: idea.duration,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${idea.key}] task ${res.id} dikirim (mode ${idea.mode})`);
  return res.id;
}

async function pollAndDownload(key: string, taskId: string): Promise<string> {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > 8 * 60_000) throw new Error(`[${key}] timeout 8mnt`);
    await new Promise((r) => setTimeout(r, 8000));
    const t = await apiRequest("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${taskId}`);
    console.log(`[${key}] ${Math.round((Date.now() - startedAt) / 1000)}s ${t.status}`);
    if (t.status === "succeeded") {
      const url = t.content?.video_url;
      if (!url) throw new Error(`[${key}] sukses tapi tanpa video_url`);
      const videoRes = await fetch(url);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outPath = path.join(OUT_DIR, `hook-${key}-forward.mp4`);
      fs.writeFileSync(outPath, buf);
      console.log(`[${key}] SELESAI: ${outPath}`);
      return outPath;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) {
      throw new Error(`[${key}] ${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
  }
}

function stitch(key: string, hookPath: string, xfadeOffset: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(OUT_DIR, `FINAL-${key}-to-real-samsung.mp4`);
    execFile(
      "ffmpeg",
      [
        "-y", "-i", hookPath, "-i", REAL_VIDEO, "-filter_complex",
        "[0:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v0];" +
          "[1:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v1];" +
          "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];" +
          "[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];" +
          `[v0][v1]xfade=transition=fadewhite:duration=0.15:offset=${xfadeOffset}[outv];` +
          "[a0][a1]acrossfade=d=0.15[outa]",
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        outPath,
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const tasks = await Promise.all(IDEAS.map((idea) => submitOne(idea).then((id) => ({ idea, id }))));
  for (const { idea, id } of tasks) {
    const hookPath = await pollAndDownload(idea.key, id);
    await stitch(idea.key, hookPath, idea.xfadeOffset);
    console.log(`[${idea.key}] STITCH SELESAI`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
