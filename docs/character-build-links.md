# Manage-modal integration: Copy build link

The UI is intentionally left to the separate manage-modal task. The helper and
CLI consumer are ready:

```js
import { characterBuildLink } from "../shared/character-build-link.js";

const link = characterBuildLink(job.character, window.location.origin);
await navigator.clipboard.writeText(link);
```

Offer this for completed jobs with `job.character.bundleUrl`. A suitable label
is **Copy build link**. If clipboard access fails, expose a read-only, selectable
input with the generated link. For private characters, explain next to the
control: **Anyone with this link can download this private fighter.**

The helper serializes only slug, display name, short name, base/fkind, variants,
and bundle/UI/voice/portrait asset URLs. It preserves capability URLs supplied
by the existing job protocol. It excludes account tokens, owner metadata, logs
and job IDs. The JSON lives in a URL fragment, so a browser request does not
send it to the website server. The link is a build import token, not a website
route that opens the character. No API or visibility changes are needed.

Both build targets accept `--character-url 'LINK'`. `--characters none` imports
only the linked fighter; otherwise links augment the selected public roster.
Multiple links can be supplied. Do not send these links to analytics or logs.

Tests: `node --test web-prototype/shared/character-build-link.test.js` and
`python3 -m unittest discover -s tests -p test_characters.py`. The latter
includes a JavaScript-export/Python-import interoperability test.
