import "dotenv/load";
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  MessageType,
  TextChannel,
  ThreadChannel,
} from "discord.js";

// --- CONFIGURATION ---
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN is not defined in the environment.");
  Deno.exit(1);
}

// --- CLIENT SETUP ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- DATA STORE ---
let mediaChannelIds: string[] = [];

async function loadChannels() {
  try {
    const fileContent = await Deno.readTextFile("./channels.json");
    mediaChannelIds = JSON.parse(fileContent);
    console.log("Successfully loaded media channel IDs:", mediaChannelIds);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(
        "channels.json not found. Creating an empty one. Please add channel IDs.",
      );
      await Deno.writeTextFile("./channels.json", "[]");
    } else {
      console.error("Failed to load or parse channels.json:", error);
      Deno.exit(1);
    }
  }
}

// --- PLURALKIT & MESSAGE PROCESSING LOGIC ---
const pendingMessages = new Map<
  string,
  { originalMessage: Message; timestamp: number }
>();
const PENDING_MESSAGE_TIMEOUT_MS = 1500; // Time to wait for a PK proxy.

async function handleMoveToThread(
  originalMessage: Message,
  displayNameForThread: string,
) {
  try {
    const channel = originalMessage.channel as TextChannel;
    let targetMessage = null;

    if (
      originalMessage.type === MessageType.Reply &&
      originalMessage.reference?.messageId
    ) {
      targetMessage = await channel.messages.fetch(
        originalMessage.reference.messageId,
      );
    } else {
      const recentMessages = await channel.messages.fetch({ limit: 10 });
      targetMessage = recentMessages.find((m) =>
        m.attachments.size > 0 || m.embeds.length > 0
      ) ?? null;
    }

    if (!targetMessage) {
      await originalMessage.author.send(
        `Your message in <#${channel.id}> was removed because it's a media-only channel and there wasn't a recent media post to start a discussion thread under.\n\n> ${originalMessage.content}`,
      ).catch(() =>
        console.warn(`Could not DM user ${originalMessage.author.id}.`)
      );
      await originalMessage.delete().catch(() => {}); // Also delete the original message
      return;
    }

    let thread: ThreadChannel | null = targetMessage.thread;
    if (!thread) {
      thread = await targetMessage.startThread({
        name: `Discussion for ${targetMessage.author.displayName}'s post`,
        autoArchiveDuration: 60,
      });
    }

    await thread.send({
      content: `**${displayNameForThread}**: ${originalMessage.content}`,
      allowedMentions: { parse: [] },
    });

    await originalMessage.author.send(
      `Your message in <#${channel.id}> has been moved to a discussion thread to keep the channel clean. You can find it here: ${thread.url}\n\n> ${originalMessage.content}`,
    ).catch(() =>
      console.warn(`Could not DM user ${originalMessage.author.id}.`)
    );

    await originalMessage.delete().catch(() => {}); // Ignore bad deletes
  } catch (error) {
    console.error("handleMoveToThread failed:", error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleProxiedMessage(proxyMessage: Message) {
  try {
    let originalAuthorId = proxyMessage.author.id;
    const response = await fetch(
      `https://api.pluralkit.me/v2/messages/${proxyMessage.id}`,
    );
    if (response.ok) {
      const pkData = await response.json();
      originalAuthorId = pkData.sender;
      const displayName = `${pkData.member.name} (${pkData.system.tag})`;
      const key = `${originalAuthorId}-${proxyMessage.channel.id}`;
      const pending = pendingMessages.get(key);
      if (pending) {
        pendingMessages.delete(key);

        await sleep(2000);

        await handleMoveToThread(pending.originalMessage, displayName);

        try {
          await proxyMessage.delete(); // Delete the proxied message
        } catch (error) {
          // Ignore failed deletes on Discord's side
          console.error("Failed to delete message:", error);
        }
      }
    } else {
      // Not a PK message, maybe another bot using webhooks?
      const key = `${originalAuthorId}-${proxyMessage.channel.id}`;
      const pending = pendingMessages.get(key);
      if (pending) {
        pendingMessages.delete(key);
      }
      return;
    }
  } catch (error) {
    console.error("Error handling proxied message:", error);
  }
}

setInterval(async () => {
  const now = Date.now();
  for (
    const [key, { originalMessage, timestamp }] of pendingMessages.entries()
  ) {
    if (now - timestamp > PENDING_MESSAGE_TIMEOUT_MS) {
      pendingMessages.delete(key);
      await handleMoveToThread(
        originalMessage,
        originalMessage.author.displayName,
      );
    }
  }
}, 500);

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
  if ((message.author.bot && !message.webhookId) || !message.guild) return;
  if (!mediaChannelIds.includes(message.channel.id)) return;
  const isMedia = message.attachments.size > 0 || message.embeds.length > 0;
  if (isMedia) return;

  const singleLinkRegex = new RegExp(
    /^https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_.~+#?&//=]*)$/i,
  );
  if (singleLinkRegex.test(message.content)) return;

  // At this point, it's a text-only message in a media channel.
  if (message.webhookId) {
    await handleProxiedMessage(message);
  } else {
    const key = `${message.author.id}-${message.channel.id}`;
    pendingMessages.set(key, {
      originalMessage: message,
      timestamp: Date.now(),
    });
  }
});

// --- LOGIN ---
async function start() {
  await loadChannels();
  console.log("Logging in...");
  await client.login(BOT_TOKEN);
}

await start();
