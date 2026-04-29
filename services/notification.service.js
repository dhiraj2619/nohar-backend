const admin = require("firebase-admin");
const User = require("../models/users.model");
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_SERVICE_ACCOUNT_JSON,
} = require("../config/config");

const INVALID_TOKEN_ERRORS = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

const FCM_BATCH_SIZE = 500;

const parseServiceAccount = () => {
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
      }
      return parsed;
    } catch (error) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:", error.message);
      return null;
    }
  }

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    return null;
  }

  return {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
};

const initializeFirebase = () => {
  if (admin.apps.length) {
    return admin.app();
  }

  const serviceAccount = parseServiceAccount();

  if (!serviceAccount) {
    return null;
  }

  try {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error.message);
    return null;
  }
};

const sanitizeDataPayload = (data = {}) =>
  Object.entries(data).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }

    acc[String(key)] = String(value);
    return acc;
  }, {});

const dedupeTokens = (tokens = []) =>
  [...new Set(tokens.map((token) => String(token || "").trim()).filter(Boolean))];

const chunkArray = (items = [], size = FCM_BATCH_SIZE) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const clearInvalidTokens = async (tokens = []) => {
  if (!tokens.length) {
    return;
  }

  try {
    await User.updateMany(
      { fcmToken: { $in: tokens } },
      { $set: { fcmToken: null } },
    );
  } catch (error) {
    console.error("Failed to clear invalid FCM tokens:", error.message);
  }
};

const sendPushToTokens = async ({
  tokens = [],
  title,
  body,
  data,
  imageUrl,
}) => {
  const normalizedTokens = dedupeTokens(tokens);

  if (!normalizedTokens.length) {
    return {
      success: false,
      configured: Boolean(initializeFirebase()),
      sentCount: 0,
      failureCount: 0,
      skipped: true,
      message: "No FCM tokens available",
    };
  }

  const app = initializeFirebase();

  if (!app) {
    return {
      success: false,
      configured: false,
      sentCount: 0,
      failureCount: normalizedTokens.length,
      skipped: true,
      message: "Firebase is not configured on server",
    };
  }

  const invalidTokens = [];
  let sentCount = 0;
  let failureCount = 0;

  for (const tokenBatch of chunkArray(normalizedTokens)) {
    const payload = {
      tokens: tokenBatch,
      notification: {
        title: String(title || "").trim(),
        body: String(body || "").trim(),
      },
      data: sanitizeDataPayload(data),
      android: {
        priority: "high",
        notification: {
          channelId: "default",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    };

    if (imageUrl) {
      payload.notification.imageUrl = imageUrl;
    }

    const response = await admin.messaging().sendEachForMulticast(payload);

    sentCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((result, index) => {
      if (result.success) {
        return;
      }

      if (INVALID_TOKEN_ERRORS.has(result.error?.code)) {
        invalidTokens.push(tokenBatch[index]);
      }
    });
  }

  if (invalidTokens.length) {
    await clearInvalidTokens(invalidTokens);
  }

  return {
    success: failureCount === 0,
    configured: true,
    sentCount,
    failureCount,
    invalidTokensRemoved: invalidTokens.length,
  };
};

const sendPushToUsers = async ({
  users = [],
  title,
  body,
  data,
  imageUrl,
}) => {
  const normalizedUsers = Array.isArray(users) ? users : [];
  const tokens = normalizedUsers
    .map((user) => user?.fcmToken)
    .filter(Boolean);

  return sendPushToTokens({
    tokens,
    title,
    body,
    data,
    imageUrl,
  });
};

module.exports = {
  initializeFirebase,
  sendPushToTokens,
  sendPushToUsers,
};
