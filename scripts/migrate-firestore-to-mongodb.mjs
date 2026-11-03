import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { MongoClient } from "mongodb";

const required = ["MONGODB_URI", "MONGODB_DB", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const privateKey = process.env.FIREBASE_PRIVATE_KEY.trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
const app = getApps().length ? getApps()[0] : initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
});
const firestore = getFirestore(app);
const mongo = await MongoClient.connect(process.env.MONGODB_URI);
const db = mongo.db(process.env.MONGODB_DB);

function convertValue(input) {
  if (input?.toDate) return input.toDate();
  if (Array.isArray(input)) return input.map(convertValue);
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, convertValue(item)]));
  return input;
}

async function copyCollection(name) {
  const snapshot = await firestore.collection(name).get();
  if (!snapshot.size) return 0;
  const collection = db.collection(name);
  const operations = snapshot.docs.map((doc) => ({
    replaceOne: { filter: { _id: doc.id }, replacement: { _id: doc.id, ...convertValue(doc.data()) }, upsert: true },
  }));
  await collection.bulkWrite(operations, { ordered: false });
  return snapshot.size;
}

for (const name of ["users", "leads", "coupons", "popups", "contactMessages", "settings"]) {
  console.log(`${name}: ${await copyCollection(name)} documents`);
}

const users = await firestore.collection("users").get();
let subcollections = 0;
for (const user of users.docs) {
  for (const name of ["transactions", "savedLeads", "pushTokens", "dismissedPopups"]) {
    const snapshot = await user.ref.collection(name).get();
    if (!snapshot.size) continue;
    const collection = db.collection(`${name}_${user.id}`);
    await collection.bulkWrite(snapshot.docs.map((doc) => ({
      replaceOne: { filter: { _id: doc.id }, replacement: { _id: doc.id, userId: user.id, ...convertValue(doc.data()) }, upsert: true },
    })), { ordered: false });
    subcollections += snapshot.size;
  }
}
console.log(`user subcollection documents: ${subcollections}`);
await mongo.close();
