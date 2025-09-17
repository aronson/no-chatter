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

## Configuration

Before running the bot, you need to configure it by setting up environment variables and specifying the channels to monitor.

### 1. Environment Variables

Create a `.env` file in the root of the project. This file is used to store sensitive information like API tokens.

```
BOT_TOKEN=your_bot_token_here
PK_TOKEN=your_pluralkit_token_here
LOG_LEVEL=info
```

-   `BOT_TOKEN` (required): Your Discord bot token.
-   `PK_TOKEN` (optional): Your PluralKit token. This is recommended to avoid rate limits when interacting with the PluralKit API.
-   `LOG_LEVEL` (optional): Sets the logging verbosity. Can be one of `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. Defaults to `info`.

### 2. Channel Configuration

Create a `channels.json` file in the root of the project. Add the IDs of the text channels you want the bot to monitor for media-only content.

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
