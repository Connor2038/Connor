# Your Vivix Character Project

This project contains the character you created in Vivix Creator. The editable
character files are in [`character/`](character/); the rest of the repository
runs those files as a standalone Next.js application.

## Start the character

1. Create an API key at <https://platform.vivix.ai/api-keys>.
2. Copy the environment example and add the key:

   ```sh
   cp .env.example .env
   ```

   ```dotenv
   VIVIX_API_KEY=your_api_key_here
   ```

3. Install and start the project:

   ```sh
   npm ci
   npm run dev
   ```

4. Open <http://localhost:3000> and select **Talk to character**.

The API key stays in the Next.js server. The browser receives only temporary
session and media credentials.

## Change your character

The Character Folder is the source of truth. Edit these files, then restart
`npm run dev` to see the result.

| File or folder                                | What it changes                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character/character.yaml`                    | Character name, avatar model, video shape, resolution, recording, and conversation defaults.                                                       |
| `character/appearance.yaml`                   | Avatar images, the default look, visual description, and the opening line and motion.                                                              |
| `character/voice.yaml`                        | Voice provider, voice ID, voice model, speed, and stability. A `tts_config` in `character.yaml` takes precedence when both are present.            |
| `character/prompts/persona.md`                | Identity, personality, speaking style, response rules, and role boundaries. This is the main file to edit when changing how the character behaves. |
| `character/prompts/motion_enhanced.md`        | Motion used while the character is speaking.                                                                                                       |
| `character/prompts/idle_motion.md`            | Motion used while the character is listening or waiting.                                                                                           |
| `character/ui/`                               | The visible experience and interactions. Edit `container.jsx`, its imported components, and CSS as normal frontend source code.                    |
| `character/rundown.yaml`                      | Ordered performances, product segments, scene changes, scripts, and replay behavior, when the character has a rundown.                             |
| `character/ui/media.yaml`                     | Videos used by rundown steps, when present.                                                                                                        |
| `character/tools/`                            | Character-specific tool declarations and their local scripts, when present.                                                                        |
| `character/knowledge/`                        | Private Markdown reference material that the character can search, when present.                                                                   |
| `character/assets/images/`                    | Named reference images explicitly bound in `character.yaml`, when present.                                                                         |
| `character/provider/vivix_official_dh30.yaml` | Imported Vivix provider settings, including the avatar, voice, start frames, region, and TRTC delivery settings, when present.                     |

For example, to change the character's tone, edit
`character/prompts/persona.md`. To change the first thing the character says,
edit `opening.dialogue` in `character/appearance.yaml`. To change the page,
edit the source files under `character/ui/`.

The preparation step compiles the Folder into `generated/` before development,
type checking, and production builds. Do not edit `generated/` directly because
it is replaced the next time a command runs.

## Custom UI actions

Custom UI code registers actions through `bridge.registerActions`. The avatar
receives one `vivix.ui.invoke` tool and chooses an exact registered action name
from the live action catalog. The browser executes the action and sends its
real result back to the avatar.

Keep action names stable and describe their visible outcome clearly. The action
parameter schema must match the arguments accepted by its handler.

## Private knowledge

Add Markdown files anywhere under `character/knowledge/`. A file can start with
optional metadata:

```md
---
schema_version: character-knowledge/v1
title: Returns Policy
source_kind: document
---

# Refund window

Customers can request a refund within 30 days.
```

At build time the project creates a local search index. The avatar is told the
available filenames and titles, and search results include the source file,
heading, and line or page location. Knowledge files and search run on the
Next.js server; the original Markdown is not shipped in the browser bundle.

## Local tools

A YAML file under `character/tools/` can expose a fixed local script command.
The project passes the tool call as JSON on stdin and expects exactly one JSON
value on stdout. Install any Python or Node dependencies required by your
script before starting the project.

## Useful commands

```sh
npm run dev      # compile the Folder and start local development
npm run check    # compile the Folder and type-check the project
npm run build    # compile the Folder and create a production build
npm start        # run the production build
```

The browser connects directly to the Vivix Realtime Avatar WebSocket and TRTC
room. The Next.js server creates and closes sessions, protects the API key,
runs local tools, and searches private knowledge.
