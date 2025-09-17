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

// --- PLURALKIT SUPPORT ---
/**
 * Checks if a message was handled by PluralKit.
 * Waits 300ms before checking the API to allow for proxying.
 * @param message The message to check.
 * @returns True if the message is a PluralKit message, false otherwise.
 */
async function isPluralKitMessage(message: Message): Promise<boolean> {
  // Wait 300ms to give PluralKit time to process and proxy the message.
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    const response = await fetch(
      `https://api.pluralkit.me/v2/messages/${message.id}`,
    );
    // If response.ok is true (status 200-299), the message exists in PluralKit's database.
    // This means it was a proxy message that has now been replaced.
    if (response.ok) {
        console.log(`Message ${message.id} was identified as a PluralKit message. Ignoring.`);
        return true;
    }
    return false;
  } catch (error) {
    console.error("Error checking PluralKit API:", error.message);
    // If the API call fails, assume it's not a PK message to be safe.
    return false;
  }
}

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bots and system messages
  if (message.author.bot || !message.guild) return;

  // Check if the message is in a designated media-only channel
  if (!mediaChannelIds.includes(message.channel.id)) return;

  // This is a media-only channel, so check if the message is media.
  // If it has attachments or embeds, it's valid, so we ignore it.
  const isMedia = message.attachments.size > 0 || message.embeds.length > 0;
  if (isMedia) return;

  // Check if the message was handled by PluralKit. If so, ignore it.
  if (await isPluralKitMessage(message)) {
    return;
  }

  // If we're here, it's a text-only message in a media channel.
  // We need to move it to a thread.

  try {
    const channel = message.channel as TextChannel;
    let targetMessage = null;

    // 1. Find the target message to create a thread under.
    if (message.type === MessageType.Reply && message.reference?.messageId) {
      targetMessage = await channel.messages.fetch(
        message.reference.messageId,
      );
    } else {
      const recentMessages = await channel.messages.fetch({ limit: 10 });
      targetMessage = recentMessages.find(
        (m) => m.attachments.size > 0 || m.embeds.length > 0,
      ) ?? null;
    }

    if (!targetMessage) {
      await message.author.send(
        `Your message in <#${channel.id}> was removed because it's a media-only channel and there wasn't a recent media post to start a discussion thread under.\n\n> ${message.content}`,
      ).catch(() =>
        console.warn(`Could not DM user ${message.author.id}.`)
      );
      await message.delete();
      return;
    }

    // 2. Find or create the thread.
    let thread: ThreadChannel | null = targetMessage.thread;
    if (!thread) {
      thread = await targetMessage.startThread({
        name: `Discussion for ${targetMessage.author.displayName}'s post`,
        autoArchiveDuration: 60,
      });
    }

    // 3. Post the user's message content into the thread.
    await thread.send({
      content: `**${message.author.displayName}**: ${message.content}`,
      allowedMentions: { parse: [] },
    });

    // 4. DM the user with a link to the thread.
    await message.author.send(
      `Your message in <#${channel.id}> has been moved to a discussion thread to keep the channel clean. You can find it here: ${thread.url}\n\n> ${message.content}`,
    ).catch(() => console.warn(`Could not DM user ${message.author.id}.`));

    // 5. Delete the original message.
    await message.delete();
  } catch (error) {
    console.error("Failed to process message:", error);
  }
});

// --- LOGIN ---
async function start() {
  await loadChannels();
  console.log("Logging in...");
  await client.login(BOT_TOKEN);
}

start();
