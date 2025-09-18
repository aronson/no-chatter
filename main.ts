import "dotenv/load";
import {
    Channel,
    Client,
    Events,
    GatewayIntentBits,
    Message,
    MessageType,
    TextChannel,
    ThreadChannel,
    User,
} from "discord.js";
import { Member, PKAPI, System } from "pkapi.js";
import adze, { Level, setup } from "adze";

// --- TOKEN CONFIG ---
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
if (!BOT_TOKEN) {
    adze.error("Error: BOT_TOKEN is not defined in the environment.");
    Deno.exit(1);
}
const PK_TOKEN = Deno.env.get("PK_TOKEN");
if (!PK_TOKEN) {
    adze.warn(
        "Error: PK_TOKEN is not defined in the environment. Rate limits on PluralKit API may be higher.",
    );
}
let activeLevel: Level | number = "info";
const LOG_LEVEL = Deno.env.get("LOG_LEVEL");
// Checks if the parsed LOG_LEVEL was a valid one for adze
function isLevel(level: string | undefined): level is Level {
    return (level as Level) !== undefined;
}
if (LOG_LEVEL) {
    if (isLevel(LOG_LEVEL)) {
        activeLevel = LOG_LEVEL;
    } else {
        // Attempt to parse numeric log levels as well
        const logInt = parseInt("LOG_LEVEL");
        if (!Number.isNaN(logInt)) {
            activeLevel = logInt;
        }
    }
}

// --- CLIENT SETUP ---

// ADZE.js presentation settings
setup({
    activeLevel: activeLevel,
    format: "pretty",
});
const logger = adze.withEmoji.timestamp.seal();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
const pluralKitClient = new PKAPI({
    base_url: "https://api.pluralkit.me", // base api url
    version: 2, // api version
    token: PK_TOKEN,
});

// --- CONFIG STORE ---
let mediaChannelIds: string[] = [];

/**
 * Loads channels from channels.json in the present working directory, or initializes the file if not present and exits
 */
async function loadChannels() {
    try {
        const fileContent = await Deno.readTextFile("./channels.json");
        mediaChannelIds = JSON.parse(fileContent);

        function isProperChannel(
            channel?: Channel | null,
        ): channel is TextChannel {
            return channel instanceof TextChannel;
        }
        const mediaChannelsWithNames =
            (await Promise.all(mediaChannelIds.map(async (channelId) => {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel instanceof TextChannel) {
                        return channel;
                    } else {
                        logger.error(
                            "Provided channel was not a text channel...",
                            channel,
                        );
                    }
                } catch (error) {
                    logger.error("Error fetching some channel...", error);
                    return null;
                }
            }))).filter(isProperChannel).map((channel) => {
                return { name: channel.name, id: channel.id };
            });
        logger.log(
            "Successfully loaded the following media channels:",
            mediaChannelsWithNames,
        );
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            logger.warn(
                "channels.json not found. Creating an empty one. Please add channel IDs.",
            );
            await Deno.writeTextFile("./channels.json", "[]");
        } else {
            logger.error("Failed to load or parse channels.json:", error);
            Deno.exit(1);
        }
    }
}

// --- HELPER METHODS ---

/**
 * Matches messages with at least one link (e.g. Tenor GIFs, Discord videos, YouTube videos, FxTwitter embeds, etc.)
 */
const someLinkRegex = new RegExp(
    /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_.~+#?&//=]*)/i,
);

/**
 * Checks a number of candidacy tests to determine if a message is or isn't valid within a "media-only" channel.
 * @param message
 */
async function isAllowedInMediaOnlyContext(message: Message): Promise<Boolean> {
    // Only parse channels in configuration
    if (!mediaChannelIds.includes(message.channel.id)) {
        return true;
    }

    // Skip bots that definitely aren't PK nor are not in a guild
    if ((message.author.bot && !message.webhookId) || !message.guild) {
        return true;
    }

    // Only respond to Default and Reply-type messages to avoid handling e.g. system messages, thread creations, etc.
    const messageTypesToRespondTo = [MessageType.Default, MessageType.Reply];
    if (
        !messageTypesToRespondTo.some((messageType) =>
            message.type == messageType
        )
    ) {
        return true;
    }

    // Skip messages with at least one attachment
    if (message.attachments.size > 0) {
        return true;
    }

    // Skip forwarded messages
    if (
        message.reference && message.messageSnapshots &&
        message.messageSnapshots.size > 0
    ) return true;

    // Skip message that is are a sticker
    if (message.stickers.size > 0) {
        return true;
    }

    if (someLinkRegex.test(message.content)) {
        return true;
    }

    // If all other tests failed, this is not an allowed message in the given channel
    return false;
}

/**
 * How long to present "ephemeral" messages before auto-deletion, in milliseconds
 */
const EPHEMERAL_MESSAGE_DISPLAY_MS = 10000;

/**
 * Sends a message with some text content in the same channel as the provided message that auto-deletes after some delay
 * @param originalMessage
 * @param content
 */
const sendEphemeralMessage = async (
    originalMessage: Message,
    content: string,
) => {
    try {
        const channel = originalMessage.channel as TextChannel;
        const message = await channel.send({
            content: content,
        });
        setTimeout(() => {
            message.delete().catch(() => {});
        }, EPHEMERAL_MESSAGE_DISPLAY_MS);
    } catch (e) {
        logger.error("Failed to send ephemeral retry message:", e);
    }
};

// --- PLURALKIT & MESSAGE PROCESSING LOGIC ---
const pendingMessages = new Map<
    string,
    { originalMessage: Message; timestamp: number }
>();

/**
 * Time to wait in milliseconds for a potential PluralKit proxy interaction to complete.
 * 2s was sufficient in testing; one may need to raise this on slow internet of if PluralKit is under too much load.
 */
const PENDING_MESSAGE_TIMEOUT_MS = 2000;

/**
 * Moves a message in a media-only channel into the nearest thread, or creates a thread for it if one isn't yet created.
 * Will delete the original message it was provided. Will add the user account to that thread if necessary. Will print
 * an "ephemeral" message for 10 seconds to inform the user of what happened and then delete that message as well.
 * @param originalMessage message object for use in fetching channels, PluralKit data, etc.; not the PluralKit message!
 * @param content the text content to display in the thread from the original or PluralKit message interaction
 * @param displayNameForThread either a User to use a rich mention, or a string for a PluralKit veneer
 */
async function handleMoveToThread(
    originalMessage: Message,
    content: string,
    displayNameForThread: User | string,
) {
    try {
        const channel = originalMessage.channel as TextChannel;
        const hostAuthor = originalMessage.author;

        let targetMessage = null;

        // Try to target messages that were directly replied to first before seeking nearby threads
        if (
            originalMessage.type === MessageType.Reply &&
            originalMessage.reference?.messageId
        ) {
            targetMessage = await channel.messages.fetch(
                originalMessage.reference.messageId,
            );
        } else {
            // Users simply responding in the channel immediately are likely referring to the most recent media post
            const recentMessages = await channel.messages.fetch({ limit: 10 });
            targetMessage = recentMessages.find((m) =>
                m.attachments.size > 0 || m.embeds.length > 0
            ) ?? null;
        }

        if (!targetMessage) {
            // Delete the original message
            await originalMessage.delete().catch(() => {});

            // Inform user we not find a candidate message...
            await sendEphemeralMessage(
                originalMessage,
                `Your message in ${channel} was removed because it's a media-only channel and there wasn't a recent media post to start a discussion thread under.\n\n>>> ${content}`,
            ).catch(() =>
                logger.error(
                    `Could not inform user ${originalMessage.author.id} with ephemeral message.`,
                )
            );
            return;
        }
        let thread: ThreadChannel | null = targetMessage.thread;
        if (!thread) {
            try {
                thread = await targetMessage.startThread({
                    name:
                        `Discussion for ${targetMessage.author.displayName}'s post`,
                    autoArchiveDuration: 60,
                });
                logger.info("Created thread:", thread);
                // If the original message is from a system webhook it may be from PluralKit
                if (targetMessage.author.bot && targetMessage.webhookId) {
                    // Test if PluralKit knows this original author
                    const metadata = await tryFetchPluralKitMetadataForMessage(
                        targetMessage,
                    );
                    if (metadata) {
                        const originalPoster = await client.users.fetch(
                            metadata.sender,
                        );
                        await thread.members.add(originalPoster.id);
                        logger.info(
                            `Added original poster ${null} thread:`,
                            thread,
                        );
                    }
                } else {
                    await thread.members.add(targetMessage.author.id);
                }
            } catch (error) {
                logger.error("Error creating an initial thread:", error);
                return;
            }
        }

        const proxiedMessageResult = await thread.send({
            content: `${displayNameForThread} originally said:\n${content}`,
            allowedMentions: { parse: ["users"] },
        });

        logger.info("Proxied a message to a thread:", proxiedMessageResult);

        try {
            await thread.members.add(hostAuthor.id);
            logger.info(
                `Added ${hostAuthor.username} to the thread "${thread.name}".`,
            );
        } catch (error) {
            logger.error("Error adding user to thread:", error);
        }

        await sendEphemeralMessage(
            originalMessage,
            `Your message in ${channel} has been moved to a discussion thread to keep the channel clean. You can find it here: ${thread}`,
        ).catch(() => {
            logger.error(
                `Could not inform user ${originalMessage.author} in ${channel} with ephemeral message.`,
            );
        });

        await originalMessage.delete().catch(() => {}); // Ignore bad deletes
    } catch (error) {
        logger.error("handleMoveToThread failed:", error);
        await sendEphemeralMessage(
            originalMessage,
            `Your message in was removed because this is a media-only channel but something went wrong proxying it for you.\n\n>>> ${content}`,
        ).catch(() =>
            logger.error(
                `Could not inform user ${originalMessage.author.id} with ephemeral message.`,
            )
        );
    }
}

/**
 * Used to pause execution for some number of milliseconds in the engine when this promise is awaited.
 * @param ms how long to wait in milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How long to wait for the PluralKit API to be ready to return metadata on a given proxied message. PluralKit upstream
 * developers have suggested 200ms, but 500ms was found necessary in real-world testing for the most consistent results.
 */
const PLURALKIT_WAIT_TIMEOUT_MS = 500;

/** */
async function tryFetchPluralKitMetadataForMessage(message: Message) {
    // Wait for pluralkit API...
    await sleep(PLURALKIT_WAIT_TIMEOUT_MS);
    try {
        return await pluralKitClient.getMessage({ message: message.id });
    } catch (error) {
        logger.warn("Error trying to fetch PluralKit metadata:", error);
        return null;
    }
}

/**
 * Main handler for potential PluralKit interactions to fetch their relevant member and system data to present.
 * @param proxyMessage some potentially PluralKit-proxied webhook message
 */
async function handleProxiedMessage(proxyMessage: Message) {
    try {
        const pkData = await tryFetchPluralKitMetadataForMessage(proxyMessage);

        // Returns OK if PluralKit proxied this message for a user
        if (pkData) {
            // Parse PluralKit metadata as JSON object
            if (!pkData.member || !pkData.system) {
                return;
            }
            const originalAuthorId = pkData.sender;
            if (!proxyMessage.guild) {
                return;
            }
            const sender = await proxyMessage.guild.members.fetch(
                originalAuthorId,
            );
            let memberName = "";
            if (pkData.member instanceof Member) {
                memberName = pkData.member.display_name ?? pkData.member.name;
            } else {
                memberName = pkData.member;
            }
            let systemTag = "";
            if (pkData.system instanceof System) {
                systemTag = pkData.system.tag ?? pkData.system.name ?? "";
            } else {
                systemTag = pkData.system;
            }
            const displayName = `${memberName} ${systemTag} (host: ${sender})`;

            // Pop original message from queue and use it and others to gather metadata
            const channel = proxyMessage.channel;
            const content = proxyMessage.content;
            const key = `${originalAuthorId}-${proxyMessage.channel.id}`;
            const pending = pendingMessages.get(key);
            if (pending) {
                const originalMessage = pending.originalMessage;
                pendingMessages.delete(key);

                // Perform move now that we have both original and PluralKit message interaction information
                try {
                    await handleMoveToThread(
                        originalMessage,
                        content,
                        displayName,
                    );
                } catch (error) {
                    await sendEphemeralMessage(
                        originalMessage,
                        `Your message in ${channel} was removed because it's a media-only channel but something went wrong proxying it for you.\n\n>>> ${content}`,
                    ).catch(() =>
                        logger.error(
                            `Could not inform user ${originalMessage.author.displayName} (${originalMessage.author.id}) with ephemeral message.`,
                        )
                    );
                    logger.error(
                        `Error attempting to proxy PluralKit message:`,
                        error,
                    );
                }

                // Clean up
                try {
                    await proxyMessage.delete(); // Delete the proxied message
                } catch (error) {
                    // Ignore failed deletes on Discord's side
                    logger.error(
                        "Failed to delete PluralKit-proxied message:",
                        error,
                    );
                }
            }
        } else {
            logger.warn(
                "Ignoring non-PluralKit message from a webhook in a media-only channel:",
                proxyMessage,
            );
        }
    } catch (error) {
        logger.error("Error handling proxied message:", error);
    }
}

/**
 * Queue process interval period in milliseconds.
 */
const QUEUE_INTERVAL_MS = 500;

// --- MAIN QUEUE LOOP ---
setInterval(async () => {
    const now = Date.now();
    // These messages are only those that passed all criteria below
    for (
        const [key, { originalMessage, timestamp }] of pendingMessages.entries()
    ) {
        // If it hasn't been removed by a PluralKit proxy interaction within the timeout, move it along
        if (now - timestamp > PENDING_MESSAGE_TIMEOUT_MS) {
            pendingMessages.delete(key);
            await handleMoveToThread(
                originalMessage,
                originalMessage.content,
                originalMessage.author,
            );
        }
    }
}, QUEUE_INTERVAL_MS);

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Ready! Logged in as ${readyClient.user.displayName}`);
    await loadChannels();
});

async function incomingMessageCreateHandler(message: Message) {
    // If the incoming message is our own thread creation message, clean it up to be tidy
    if (
        message.type == MessageType.ThreadCreated &&
        message.author.id == client.user?.id
    ) {
        await message.delete();
        return;
    }

    // If an incoming message is "allowed" do nothing and exit early
    if (await isAllowedInMediaOnlyContext(message)) return;

    // At this point, it's a text-only message in a media channel
    if (message.webhookId) {
        // If it could be a PluralKit-proxied message because it's a webhook, handle that
        await handleProxiedMessage(message);
    } else {
        // It's not PluralKit-proxied yet, but may initiate a PK proxy, so queue it up
        const key = `${message.author.id}-${message.channel.id}`;
        pendingMessages.set(key, {
            originalMessage: message,
            timestamp: Date.now(),
        });
    }
}
client.on(Events.MessageCreate, incomingMessageCreateHandler);

// --- LOGIN ---
async function start() {
    logger.info("Logging in...");
    await client.login(BOT_TOKEN);
}

// --- ENTRYPOINT ---
await start();
