import "dotenv/config";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
const redisClients = new Map();
const connectPromises = new Map();

const createRedisConnection = (name) => {
  const client = createClient({
    url: REDIS_URL,
  });

  client.on("error", (error) => {
    console.error(`Redis ${name} client error:`, error);
  });

  return client;
};

const getNamedRedisClient = async (name) => {
  let client = redisClients.get(name);

  if (!client) {
    client = createRedisConnection(name);
    redisClients.set(name, client);
  }

  if (client.isOpen) {
    return client;
  }

  let connectPromise = connectPromises.get(name);
  if (!connectPromise) {
    connectPromise = client.connect().catch((error) => {
      connectPromises.delete(name);
      throw error;
    });

    connectPromises.set(name, connectPromise);
  }

  await connectPromise;
  connectPromises.delete(name);

  return client;
};

export const getRedisClient = () => getNamedRedisClient("default");

export const getRedisSubscriberClient = () => getNamedRedisClient("subscriber");

export default getRedisClient;
