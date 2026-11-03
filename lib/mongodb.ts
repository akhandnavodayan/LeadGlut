import { MongoClient, Db, Collection, Document } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "leadglut";

declare global {
  // eslint-disable-next-line no-var
  var leadglutMongoClient: Promise<MongoClient> | undefined;
}

function clientPromise() {
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  if (!global.leadglutMongoClient) {
    global.leadglutMongoClient = new MongoClient(uri).connect();
  }
  return global.leadglutMongoClient;
}

export async function mongoDb(): Promise<Db> {
  return (await clientPromise()).db(databaseName);
}

export async function mongoCollection<T extends Document = Document>(
  name: string,
): Promise<Collection<T>> {
  return (await mongoDb()).collection<T>(name);
}
