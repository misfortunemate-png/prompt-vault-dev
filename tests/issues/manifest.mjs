import pv016 from './pv-016-backend-identity.mjs';
import pv020 from './pv-020-save-partial-failure.mjs';
import pv023 from './pv-023-cors-preview.mjs';

export const issueVerifiers = Object.freeze({
  [pv016.issue]: pv016,
  [pv020.issue]: pv020,
  [pv023.issue]: pv023,
});
