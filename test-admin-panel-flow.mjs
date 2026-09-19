import jwt from "jsonwebtoken";

const JWT_SECRET = "d5de0dc567ade807b147682c7cf9086a48849120e50a7621e060a9a4803da2a5";
const adminToken = jwt.sign(
  { id: "699d92863d14f4bc6727f915", tokenVersion: 18 },
  JWT_SECRET,
  { expiresIn: "1h" }
);

async function runTest() {
  console.log("=== 1. Testing GET /notifications/broadcasts (Before Dispatch) ===");
  const getRes = await fetch("http://localhost:5000/notifications/broadcasts", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const getData = await getRes.json();
  console.log("Status:", getRes.status);
  console.log("Initial Stats:", JSON.stringify(getData.stats, null, 2));
  console.log("Initial Campaign Count:", getData.campaigns?.length);

  console.log("\n=== 2. Testing POST /notifications/broadcast (Dispatching New Broadcast) ===");
  const testTitle = `🔥 Special Weekend Flash Sale ${Date.now()}`;
  const testMessage = "Get 25% instant cashback on all tickets today with code FLASH25!";
  const postRes = await fetch("http://localhost:5000/notifications/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title: testTitle,
      message: testMessage,
      channel: "Push Notification",
      targetSegment: "All Registered Users",
      deepLink: "/movies",
    }),
  });
  const postData = await postRes.json();
  console.log("POST Status:", postRes.status, postData);

  console.log("\nWaiting 2.5 seconds for BullMQ worker to process...");
  await new Promise((r) => setTimeout(r, 2500));

  console.log("\n=== 3. Testing GET /notifications/broadcasts (After Dispatch) ===");
  const afterRes = await fetch("http://localhost:5000/notifications/broadcasts", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const afterData = await afterRes.json();
  console.log("After Status:", afterRes.status);
  console.log("Updated Stats:", JSON.stringify(afterData.stats, null, 2));
  console.log("Updated Campaign Count:", afterData.campaigns?.length);

  const latest = afterData.campaigns?.[0];
  console.log("\n=== 4. Verifying Latest Broadcast Item in List ===");
  console.log({
    id: latest?.id,
    title: latest?.title,
    body: latest?.body,
    channel: latest?.channel,
    targetSegment: latest?.targetSegment,
    sentCount: latest?.sentCount,
    readCount: latest?.readCount,
    openRate: latest?.openRate,
    dispatchedAt: latest?.dispatchedAt,
    status: latest?.status,
  });

  if (latest?.title === testTitle && latest?.status === "Delivered" && latest?.sentCount > 0) {
    console.log("\n✅ VERIFICATION SUCCESS: Real broadcast data is accurately populated and listed!");
  } else {
    console.warn("\n⚠️ Unexpected campaign fields:", latest);
  }

  process.exit(0);
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
