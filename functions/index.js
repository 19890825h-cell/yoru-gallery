const crypto = require("node:crypto");
const { Client, handle_file } = require("@gradio/client");
const { initializeApp } = require("firebase-admin/app");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

initializeApp();

const CLOUDINARY_CLOUD_NAME = "dlab6ddls";
const CLOUDINARY_API_KEY = defineSecret("CLOUDINARY_API_KEY");
const CLOUDINARY_API_SECRET = defineSecret("CLOUDINARY_API_SECRET");
const HF_TOKEN = defineSecret("HF_TOKEN");

const WD14_SPACE_ID = "SmilingWolf/wd-tagger";
const WD14_MODEL = "SmilingWolf/wd-v1-4-moat-tagger-v2";
const WD14_GENERAL_THRESHOLD = 0.35;
const WD14_CHARACTER_THRESHOLD = 0.85;
const WD14_MAX_TAGS = 20;

let wd14ClientPromise = null;

function normalizeWd14Tag(tag) {
  return String(tag || "")
    .trim()
    .replace(/\\/g, "")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function extractWd14TagsFromResult(payload) {
  const data = payload && Array.isArray(payload.data) ? payload.data : [];
  const characters = Array.isArray(data[2]?.confidences) ? data[2].confidences : [];
  const general = Array.isArray(data[3]?.confidences) ? data[3].confidences : [];
  const merged = [
    ...characters
      .filter((item) => Number(item?.confidence) >= WD14_CHARACTER_THRESHOLD)
      .map((item) => [item.label, item.confidence]),
    ...general
      .filter((item) => Number(item?.confidence) >= WD14_GENERAL_THRESHOLD)
      .map((item) => [item.label, item.confidence]),
  ];
  const deduped = [
    ...new Set(
      merged
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([tag]) => normalizeWd14Tag(tag))
        .filter(Boolean),
    ),
  ];
  return deduped.slice(0, WD14_MAX_TAGS);
}

async function getWd14Client() {
  if (!wd14ClientPromise) {
    wd14ClientPromise = Client.connect(WD14_SPACE_ID, {
      hf_token: HF_TOKEN.value(),
    });
  }
  return wd14ClientPromise;
}

exports.cloudinaryDeleteAsset = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET],
  },
  async (request) => {
    const publicId = String(request.data?.publicId || "").trim();
    if (!publicId) {
      throw new HttpsError("invalid-argument", "publicId is required");
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signatureBase = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET.value()}`;
    const signature = crypto.createHash("sha1").update(signatureBase).digest("hex");

    const body = new URLSearchParams({
      public_id: publicId,
      api_key: CLOUDINARY_API_KEY.value(),
      timestamp: String(timestamp),
      signature,
    });

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new HttpsError("internal", `Cloudinary delete failed: ${detail}`);
    }

    return await response.json();
  },
);

exports.hfTagImage = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "1GiB",
    secrets: [HF_TOKEN],
  },
  async (request) => {
    const imageUrl = String(request.data?.imageUrl || "").trim();
    if (!imageUrl) {
      throw new HttpsError("invalid-argument", "imageUrl is required");
    }

    const client = await getWd14Client();
    const result = await client.predict("/predict", {
      image: handle_file(imageUrl),
      model_repo: WD14_MODEL,
      general_thresh: WD14_GENERAL_THRESHOLD,
      general_mcut_enabled: false,
      character_thresh: WD14_CHARACTER_THRESHOLD,
      character_mcut_enabled: false,
    });

    const tags = extractWd14TagsFromResult(result);
    return { tags };
  },
);
