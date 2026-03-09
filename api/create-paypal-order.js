import { getPayPalAccessToken } from "./paypal-client.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { planType } = req.body;

    const amount = planType === "yearly" ? "90.00" : "9.00";

    const accessToken = await getPayPalAccessToken();

    const response = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: amount,
            },
          },
        ],
        application_context: {
          return_url: "https://kontrijal.com",
          cancel_url: "https://kontrijal.com",
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data });
    }

    const approveLink = data.links?.find((link) => link.rel === "approve")?.href;

    return res.status(200).json({ url: approveLink });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
