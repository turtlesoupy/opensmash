# Custom-character download URLs and optional build links

The manage modal now exposes `job.character.bundleUrl` as **Character download
URL**. The native/ROM importer accepts that URL directly. For capability URLs,
it reads `/engine/fighters/SLUG-CAPABILITY/manifest.json`, then uses companion
`.osbui`/`.wav` URLs with the same capability. For public versioned URLs, it
reads the version's manifest and uses its artifact URLs. Private manifests can
have null artifact URLs; the importer derives the already-supported capability
routes instead. It never constructs direct links to the private storage bucket.

The `.osbui` includes the emblem and stock/menu sprites. Native preparation
requires a nonempty emblem and a compatible PCM16 announcer WAV for these
custom downloads. No UI or server endpoint changes are required.

The optional helper below additionally carries the current base/fkind, which
is not present in immutable download manifests. It remains available if the
modal later wants a separate **Copy build link** control:

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
