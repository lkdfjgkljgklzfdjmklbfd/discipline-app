import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_JSON))
  });
}

const db = admin.firestore();

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");

  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error_description || "Failed to get PayPal access token");
  }

  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!idToken) {
      return res.status(401).json({ error: "Missing auth token" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { newPlanId } = req.body || {};
    if (!newPlanId) {
      return res.status(400).json({ error: "Missing newPlanId" });
    }

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.data();
    const subscriptionID = userData?.paypalSubscriptionId;

    if (!subscriptionID) {
      return res.status(400).json({ error: "No active PayPal subscription found" });
    }

    const accessToken = await getPayPalAccessToken();

    const reviseRes = await fetch(
      `https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionID}/revise`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          plan_id: newPlanId
        })
      }
    );

    const reviseData = await reviseRes.json();

    if (!reviseRes.ok) {
      return res.status(400).json({
        error: reviseData?.message || "PayPal revise failed",
        details: reviseData
      });
    }

    await userRef.set({
      plan: "premium",
      subscriptionStatus: "active",
      billingType: "yearly",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return res.status(200).json({ ok: true, reviseData });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
