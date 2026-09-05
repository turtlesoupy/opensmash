import assert from 'node:assert/strict';
import test from 'node:test';
import { characterBuildLink } from './character-build-link.js';

test('build link preserves private capability assets without owner or session data', () => {
  const link = new URL(characterBuildLink({slug:'custom', name:'My 私人 fighter', fkind:4,
    bundleUrl:'/engine/bundles/custom-AbCd012345678901.osb6', uiUrl:'/private/ui.osbui',
    ownerId:'secret', token:'secret', visibility:'private'}, 'https://smash.fun'));
  assert.equal(link.search, '');
  const data = JSON.parse(new URLSearchParams(link.hash.slice(1)).get('opensmash-character'));
  assert.equal(data.bundleUrl, 'https://smash.fun/engine/bundles/custom-AbCd012345678901.osb6');
  assert.equal(data.fkind, 4);
  assert.equal(data.name, 'My 私人 fighter');
  assert.equal(data.ownerId, undefined);
  assert.equal(data.token, undefined);
});
test('unfinished characters and non-network assets are rejected', () => {
  assert.throws(() => characterBuildLink({slug:'x'}, 'https://smash.fun'));
  assert.throws(() => characterBuildLink({slug:'x',bundleUrl:'file:///etc/passwd'}, 'https://smash.fun'));
});
