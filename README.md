# WhatsApp Chat Viewer

Read your exported WhatsApp chats in an interface that looks and feels like WhatsApp Web: photos, videos, voice messages, calls, search and all. Then go further than WhatsApp does, with insights, memories, search across every chat and merged exports.

It is **view only**, runs entirely on your own machine, and has **no dependencies** beyond Node.js or Docker.

![A chat open in the viewer](docs/screenshots/chat.jpg)

> **Not affiliated with WhatsApp.** This is an independent, read-only viewer for chats you exported yourself. It is not affiliated with, endorsed by or connected to WhatsApp or Meta. "WhatsApp" is a trademark of its owner. The chats in these screenshots are fictional samples.

## Features

**Reading chats**

- **Looks like WhatsApp Web** in light and dark mode, on desktop and phone-sized screens.
- **Imports the export .zip directly.** Drag it in; nothing to unzip or convert.
- **Every message type an export contains**: text with formatting and links, photos, videos, GIFs, stickers, voice messages, documents, contact cards, locations, polls, calls, edited and deleted messages, and group events.
- **Voice messages** with a real waveform, scrubbing and 1×, 1.5×, 2× speed.
- **Group chats** with coloured sender names and system messages.

**Finding things**

- **Search in a chat**, or jump straight to a date.
- **Search across all chats** with filters for sender, date range, and media, links or documents.
- **Media, links and docs** for one chat or all chats, with sorting, filters, multi-select, download and star.
- **Starred messages**: star anything and find it again in one list.
- **Calls tab** listing every call found in your chats.

**Going further**

- **Insights**: who talks most, messages over time, busiest hours and days, a day-by-day heatmap, streaks, reply times, top emoji and words.
- **Memories**: what was said on this day in earlier years, or a random day to revisit.
- **Merged exports**: import a newer export of a chat you already have and the two become one chat, with duplicates removed.
- **Your own names and photos** for chats, and a photo for yourself.
- **Chat themes**: 26 wallpapers and bubble colours, custom colours or your own background, for all chats or just one.
- **Link previews** (optional, off by default).

**Keeping it yours**

- **Persistent**: imported chats are kept in a Docker volume or a local folder, so they are still there after a restart.
- **Screen lock**: an optional password. With it set, the server refuses to hand out your chats until it is entered.
- **Private**: no account, no analytics. Nothing leaves your machine unless you switch on link previews.

| Every message type | Group chats and polls |
| --- | --- |
| ![Calls, documents and contact cards in a chat](docs/screenshots/chat-types.jpg) | ![A group chat with a poll](docs/screenshots/group.jpg) |

| Insights | Day-by-day heatmap, hours and weekdays |
| --- | --- |
| ![Chat insights](docs/screenshots/insights.jpg) | ![More insights](docs/screenshots/insights-2.jpg) |

| Search across all chats, with filters | Search inside a chat |
| --- | --- |
| ![Search across chats](docs/screenshots/search-all.jpg) | ![Searching a chat](docs/screenshots/search.jpg) |

| Media from all chats, with selection | Links |
| --- | --- |
| ![Selecting media](docs/screenshots/media-select.jpg) | ![Links from all chats](docs/screenshots/links.jpg) |

| Starred messages | Memories |
| --- | --- |
| ![Starred messages](docs/screenshots/starred.jpg) | ![Memories](docs/screenshots/memories.jpg) |

| Contact info: rename, photo, per-chat theme | Chat themes |
| --- | --- |
| ![Contact info](docs/screenshots/contact.jpg) | ![Choosing a chat theme](docs/screenshots/themes.jpg) |

| Calls | Dark mode |
| --- | --- |
| ![Call history](docs/screenshots/calls.jpg) | ![Dark mode](docs/screenshots/chat-dark.jpg) |

| Settings | Screen lock |
| --- | --- |
| ![Settings](docs/screenshots/settings.jpg) | ![Screen lock](docs/screenshots/lock.jpg) |

<p align="center">
  <img src="docs/screenshots/mobile-list.jpg" alt="Chat list on a phone" width="260">
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-chat.jpg" alt="A chat on a phone" width="260">
</p>

## Run it

### Docker (recommended)

```bash
git clone https://github.com/ajalilmian/whatsapp-chat-viewer.git
cd whatsapp-chat-viewer
docker compose up -d
```

Open <http://localhost:8080>. Imported chats, settings, photos and your custom background are stored in the `chat-data` volume and survive restarts and rebuilds.

To stop it, run `docker compose down`. Add `-v` only if you also want to delete the saved chats.

By default the port is bound to your own machine (`127.0.0.1`). To open the viewer from other devices on your network, change the port line in `docker-compose.yml` to `"8080:8080"` and turn on the screen lock in Settings.

### Node.js (no install step)

Needs Node.js 18 or newer.

```bash
node server.js
```

Open <http://localhost:5178>. Chats are saved in a `data/` folder next to the app.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5178` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to bind to |
| `DATA_DIR` | `./data` | Where chats and settings are saved |

### Static files only

The app also works from any static file server, for example `python3 -m http.server`. In that case imported chats are kept in the browser's own storage (IndexedDB) instead of on a server, so they are tied to that one browser. Link previews are not available this way, and the screen lock only hides chats rather than protecting them.

## Use it

### 1. Export a chat from WhatsApp

1. Open the chat on your phone.
   - **iPhone:** tap the contact or group name at the top, then **Export chat**.
   - **Android:** tap the three dots, then **More**, then **Export chat**.
2. Choose **Attach media** (iPhone) or **Include media** (Android) to keep photos, videos and voice messages.
3. Save the resulting `.zip` and get it onto your computer. Do not unzip it.

### 2. Import it

Click the **+** button above the chat list, or drag the `.zip` anywhere onto the window. You can import as many chats as you like.

Importing another export of a chat you already have offers to **merge** them. Messages found in both are kept once, so you can top up a chat with a newer export. Merging can be undone from the chat's info panel.

Want to try it first? Import the two fictional chats in [`sample/`](sample).

### 3. Look around

- **Which side is you:** your messages should be on the right. The viewer works this out from the chat names; if it guesses wrong, pick your name under **Settings → Which side is you**. It applies to every chat.
- **Search:** the magnifier in a chat searches that chat, and its calendar jumps to a day. Typing in the box above the chat list searches every chat; the filter button beside it narrows by sender, dates, or media, links and docs.
- **Media, links and docs:** the gallery icon in the left rail covers all chats. Use the tick-box icon to select several items, then download or star them.
- **Star a message:** hover over it, open the small arrow menu and choose **Star**. Starred messages are listed under **Starred messages** in the menus.
- **Contact info:** click a chat's name to rename it, give it a photo, set a theme for just that chat, or open its insights.
- **Insights:** the chart icon in the left rail. Click a day in the heatmap to open it in the chat.
- **Memories:** the clock icon in the left rail.
- **Calls:** the phone icon in the left rail. Click a call to see it in context.
- **Themes:** **Settings → Chat theme**.
- **Screen lock and link previews:** both under **Settings**.
- **Help:** **Settings → How to use** repeats these steps inside the app.

![The in-app guide](docs/screenshots/help.jpg)

## Good to know

- **View only.** The message box, call buttons and a few rail icons (Status, Channels, Communities) are there to match the look; they do nothing.
- **What an export does not contain.** WhatsApp leaves out reactions, which message a reply was to, read receipts, forwarded labels and profile photos, so the viewer cannot show them.
- **Merging relies on timestamps.** Two exports of the same chat line up when they were made on phones set to the same time zone and clock format. If not, messages may appear twice.
- **Tested mostly with iPhone exports.** Android's export format is supported by the parser but has had less testing. If a chat does not load correctly, please open an issue with a few anonymised lines of the `.txt` file.
- **Browsers.** Built and tested in Chrome. It uses standard web features and should work in current Firefox, Edge and Safari.

## Privacy

- Your chats stay in the folder or Docker volume you run the viewer from. Nothing is uploaded to any third party.
- **Link previews are the one feature that contacts the internet.** When switched on, the viewer's server fetches the title and picture of links that appear in your chats, which tells those sites that someone looked the link up. It is off by default, only public web addresses are fetched, and results are cached in the data folder.
- **Screen lock.** With a password set, the server will not return chats, media or settings until it is entered. The password is stored as a salted hash. Chats on disk are not encrypted, so the lock protects access through the viewer, not the files themselves.
- The server has no other login, which is why it listens on `127.0.0.1` by default.
- The `.gitignore` excludes `*.zip` and `data/` so a real export cannot be committed by accident if you fork this.

## How it works

```
index.html, css/, js/   The app. Plain HTML, CSS and JavaScript, no build step.
  js/parser.js          Turns the export's text file into messages (iOS and Android layouts).
  js/zip.js             Reads the export .zip lazily, so media is only loaded when shown.
  js/store.js           Saves chats to the server, or to the browser when there is no server.
  js/app.js             Chats, messages, settings and themes.
  js/gallery.js         Media, links and docs.
  js/insights.js        Insights and memories.
  js/extras.js          Stars, contact info, screen lock, link previews, search across chats.
server.js               A small dependency-free server with persistent storage.
assets/chat-bg.svg      The doodle wallpaper, generated by tools/make-doodles.js.
sample/                 Two fictional exports to try the viewer with.
```

The wallpaper doodles are original artwork generated by `tools/make-doodles.js`. Interface icons are from Google's [Material Icons](https://fonts.google.com/icons) (Apache License 2.0).

To use a different wallpaper tile, save an SVG as `assets/chat-bg.local.svg`; `server.js` serves it in place of the bundled one, and it is ignored by git.

## License

[MIT](LICENSE)

## Disclaimer

This project is an independent, unofficial viewer. It is not affiliated with, endorsed by, sponsored by or connected to WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of its owner and is used here only to describe the files this tool reads. Only use it with chats you have the right to view.
