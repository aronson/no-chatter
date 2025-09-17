# No Chatter

No Chatter is a powerful and intuitive Discord bot designed to keep your
media-only channels pristine. It intelligently detects text-only messages in
designated channels and automatically moves them into organized discussion
threads, ensuring your media remains the star of the show.

## Features

- **Automatic Thread Creation**: No Chatter automatically creates a new thread
  for any text-based discussion, keeping your media channels clean and focused.
- **PluralKit Integration**: The bot is designed to work seamlessly with
  PluralKit, correctly identifying and moving messages from proxied accounts.
- **Configurable**: You can easily configure which channels the bot should
  monitor by adding their IDs to the `channels.json` file.
- **User-Friendly Notifications**: When a message is moved, the bot sends a
  direct message to the user, letting them know where to find their message and
  continue the conversation.

## Prerequisites

- [Deno](https://deno.land/) runtime installed on your system.
- A Discord bot token with the following intents:
  - `Guilds`
  - `GuildMessages`
  - `MessageContent`

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aronson/no-chatter.git
   cd no-chatter
   ```

2. **Create a `.env` file:** Create a `.env` file in the root of the project and
   add your Discord bot token:
   ```
   BOT_TOKEN=your_bot_token_here
   ```

3. **Create a `channels.json` file:** Create a `channels.json` file in the root
   of the project and add the IDs of the channels you want the bot to monitor:
   ```json
   [
     "channel_id_1",
     "channel_id_2"
   ]
   ```

## Usage

To start the bot, run the following command in the project root:

```bash
deno task start
```

## Deployment

For easier deployment, you can compile the bot into a single executable using
the `prepare` task. This will create a file named `no-chatter` in the project
root.

```bash
deno task prepare
```

Once the executable is created, you can run it directly:

```bash
./no-chatter
```

## Contributing

Contributions are welcome! If you have any ideas, suggestions, or bug reports,
please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE.md)
file for details.
