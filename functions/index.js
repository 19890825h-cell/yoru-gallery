const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const CLOUDINARY_API_KEY = defineSecret("CLOUDINARY_API_KEY");
const CLOUDINARY_API_SECRET = defineSecret("CLOUDINARY_API_SECRET");
const CLOUDINARY_CLOUD_NAME = "dlab6ddls";

exports.cloudinaryDeleteAsset = onCall(
  {
    secrets: [CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET],
    cors: true,
  },
  async (request) => {
    const publicId = String(request.data?.publicId || "").trim();
    if (!publicId) {
      throw new HttpsError("invalid-argument", "publicId is required.");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const apiKey = CLOUDINARY_API_KEY.value();
    const apiSecret = CLOUDINARY_API_SECRET.value();
    const signatureBase = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(signatureBase).digest("hex");

    const form = new URLSearchParams();
    form.set("public_id", publicId);
    form.set("invalidate", "true");
    form.set("timestamp", String(timestamp));
    form.set("api_key", apiKey);
    form.set("signature", signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );

    const payload = await response.json();
    if (!response.ok || payload.result === "not found") {
      throw new HttpsError(
        "internal",
        payload.error?.message || `Cloudinary delete failed: ${payload.result || response.status}`
      );
    }

    return {
      ok: true,
      result: payload.result,
      publicId,
    };
  }
);
